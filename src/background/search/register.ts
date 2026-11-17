// The `/` register in storage.local: the last committed search. `n` and `N` read it, in any window, and it outlives the command line session that wrote it.

import { SEARCH_REGISTER_STORAGE_KEY } from "../../shared/protocol.ts";
import type { SearchDirection } from "../../shared/protocol.ts";

export interface SearchRegister {
    text: string;
    direction: SearchDirection;
}

export interface SearchRegisterStorage {
    get(key: string): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
}

export interface SearchRegisterStore {
    read(): Promise<SearchRegister | undefined>;
    write(register: SearchRegister): Promise<void>;
}

function valid_register(value: unknown): SearchRegister | undefined {
    const stored = value as Partial<SearchRegister> | null | undefined;
    if (typeof stored?.text !== "string" || stored.text === "") return undefined;
    return stored.direction === "forward" || stored.direction === "backward" ? { text: stored.text, direction: stored.direction } : undefined;
}

export function create_search_register(storage: SearchRegisterStorage): SearchRegisterStore {
    return {
        read: async () => valid_register((await storage.get(SEARCH_REGISTER_STORAGE_KEY))[SEARCH_REGISTER_STORAGE_KEY]),
        write: (register) => storage.set({ [SEARCH_REGISTER_STORAGE_KEY]: register }),
    };
}
