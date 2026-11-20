// Stand-ins for the Thunderbird globals the chrome parent reads, so node can load and drive it.

export interface PlatformStub {
    window_listeners: Map<string, { chromeURLs: string[]; onLoadWindow(window: unknown): void; onUnloadWindow(window: unknown): void }>;
    register_calls: number;
    restore(): void;
}

export class StubExtensionError extends Error {}

export function stub_platform(main_windows: unknown[] = []): PlatformStub {
    const stub: PlatformStub = { window_listeners: new Map(), register_calls: 0, restore: () => {} };
    const modules: Record<string, Record<string, unknown>> = {
        "resource://gre/modules/ExtensionCommon.sys.mjs": {
            ExtensionCommon: {
                EventManager: class {
                    options: { register(fire: { async(value: unknown): void }): () => void };
                    constructor(options: { register(fire: { async(value: unknown): void }): () => void }) {
                        this.options = options;
                    }
                    api() {
                        const options = this.options;
                        return { subscribe: (listener: (value: unknown) => void) => options.register({ async: listener }) };
                    }
                },
            },
        },
        "resource:///modules/ExtensionSupport.sys.mjs": {
            ExtensionSupport: {
                registerWindowListener(id: string, listener: never) {
                    stub.register_calls++;
                    stub.window_listeners.set(id, listener);
                },
                unregisterWindowListener: (id: string) => stub.window_listeners.delete(id),
            },
        },
        "resource://gre/modules/ExtensionUtils.sys.mjs": { ExtensionUtils: { ExtensionError: StubExtensionError } },
    };
    // The pages API loads the page actor's parent from a `resource://` root of its own. Here it is a module that does nothing.
    const page_actor = { start() {}, stop() {}, set_keys() {}, set_insert() {}, takes_keys: () => false, scroll: () => false, blur: () => false };
    const globals = globalThis as Record<string, unknown>;
    const before = { ChromeUtils: globals["ChromeUtils"], Services: globals["Services"], Ci: globals["Ci"] };
    globals["ChromeUtils"] = { importESModule: (url: string) => modules[url] ?? (url.startsWith("resource://desertbird-actor-") ? page_actor : undefined) };
    globals["Services"] = { wm: { getEnumerator: () => main_windows }, io: { getProtocolHandler: () => ({ QueryInterface: () => ({ setSubstitution() {} }) }) } };
    globals["Ci"] = { nsIResProtocolHandler: {} };
    stub.restore = () => {
        globals["ChromeUtils"] = before.ChromeUtils;
        globals["Services"] = before.Services;
        globals["Ci"] = before.Ci;
    };
    return stub;
}

/** One port of a fake `runtime.connectNative`: it records what the add-on posts and lets a test speak as the host. */
export interface FakeNativePort {
    posted: object[];
    disconnected: boolean;
    postMessage(message: object): void;
    disconnect(): void;
    onMessage: { addListener(listener: (message: unknown) => void): void; removeListener(listener: (message: unknown) => void): void };
    onDisconnect: { addListener(listener: (port: unknown) => void): void; removeListener(listener: (port: unknown) => void): void };
    /** The host sends a frame. */
    host_says(message: unknown): void;
    /** The host process ends, as when it exits or is not installed. */
    host_drops(): void;
    listener_count(): number;
}

export interface FakeNativeMessaging {
    ports: FakeNativePort[];
    names: string[];
    connectNative(application: string): FakeNativePort;
    /** Makes the next connect throw, as a missing permission does. */
    fail_next: boolean;
}

export function fake_native_messaging(): FakeNativeMessaging {
    const fake: FakeNativeMessaging = {
        ports: [],
        names: [],
        fail_next: false,
        connectNative(application) {
            if (fake.fail_next) {
                fake.fail_next = false;
                throw new Error("no native messaging");
            }
            const message_listeners = new Set<(message: unknown) => void>();
            const disconnect_listeners = new Set<(port: unknown) => void>();
            const port: FakeNativePort = {
                posted: [],
                disconnected: false,
                postMessage(message) {
                    if (port.disconnected) throw new Error("the port is closed");
                    port.posted.push(message);
                },
                disconnect: () => void (port.disconnected = true),
                onMessage: { addListener: (listener) => void message_listeners.add(listener), removeListener: (listener) => void message_listeners.delete(listener) },
                onDisconnect: { addListener: (listener) => void disconnect_listeners.add(listener), removeListener: (listener) => void disconnect_listeners.delete(listener) },
                host_says: (message) => [...message_listeners].forEach((listener) => listener(message)),
                host_drops() {
                    port.disconnected = true;
                    [...disconnect_listeners].forEach((listener) => listener(port));
                },
                listener_count: () => message_listeners.size + disconnect_listeners.size,
            };
            fake.names.push(application);
            fake.ports.push(port);
            return port;
        },
    };
    return fake;
}
