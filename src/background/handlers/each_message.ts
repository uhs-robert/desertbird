import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";

/** The ids taken at the key press. An empty selection is a refusal, since a handler has nothing to act on. */
export function require_messages(message_ids: number[]): number[] {
    if (message_ids.length === 0) throw new RuntimeRefusal("No message is selected.");
    return message_ids;
}

/** Runs `act` on each selected id in order, one at a time, and stops at the first failure. A failure after the first message says how many were done, since the selection is then half changed. */
export async function for_each_message(message_ids: number[], act: (id: number) => Promise<void>): Promise<void> {
    const ids = require_messages(message_ids);
    for (const [index, id] of ids.entries()) {
        try {
            await act(id);
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            if (index === 0) throw error;
            throw new RuntimeRefusal(`${reason} ${index} of ${ids.length} messages changed before it.`);
        }
    }
}
