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
    const globals = globalThis as Record<string, unknown>;
    const before = { ChromeUtils: globals["ChromeUtils"], Services: globals["Services"] };
    globals["ChromeUtils"] = { importESModule: (url: string) => modules[url] };
    globals["Services"] = { wm: { getEnumerator: () => main_windows } };
    stub.restore = () => {
        globals["ChromeUtils"] = before.ChromeUtils;
        globals["Services"] = before.Services;
    };
    return stub;
}
