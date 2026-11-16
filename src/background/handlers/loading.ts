import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";

// Thunderbird raises this text when an API call converts a mail tab whose folder has no sort yet. The call reads `DBViewWrapper.primarySortType` before the first display finishes. The text is all the error carries, so the helper trusts it only around a call on a tab, where the loading state is the usual cause.
const FIRST_DISPLAY_ERROR = /^An unexpected error occurred\.?$/;

/** Runs a call on a mail tab and turns the first-display error into a refusal that names the cause. Any other error passes through. */
export async function while_loading<T>(call: () => Promise<T>): Promise<T> {
    try {
        return await call();
    } catch (error) {
        if (error instanceof Error && FIRST_DISPLAY_ERROR.test(error.message)) throw new RuntimeRefusal("The folder is still loading. Try again in a moment.");
        throw error;
    }
}
