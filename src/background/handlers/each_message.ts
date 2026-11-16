import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";

/** The ids taken at the key press. An empty selection is a refusal, since a handler has nothing to act on. */
export function require_messages(message_ids: number[]): number[] {
    if (message_ids.length === 0) throw new RuntimeRefusal("No message is selected.");
    return message_ids;
}

/** Runs `act` on each selected id in order, one at a time, and stops at the first failure. */
export async function for_each_message(message_ids: number[], act: (id: number) => Promise<void>): Promise<void> {
    for (const id of require_messages(message_ids)) await act(id);
}
