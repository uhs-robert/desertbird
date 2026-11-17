import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";

// Thunderbird raises this text when the tab query converts a mail tab whose folder has no sort yet, during the first display. Only that query is wrapped: the same text from a later call is a real failure.
const FIRST_DISPLAY_ERROR = /^An unexpected error occurred\.?$/;

export const is_first_display_error = (error: unknown): boolean => error instanceof Error && FIRST_DISPLAY_ERROR.test(error.message);

/** Runs the mail tab query and turns the first-display error into a refusal that names the cause. Any other error passes through. */
export async function while_loading<T>(call: () => Promise<T>): Promise<T> {
    try {
        return await call();
    } catch (error) {
        if (is_first_display_error(error)) throw new RuntimeRefusal("The folder is still loading. Try again in a moment.");
        throw error;
    }
}
