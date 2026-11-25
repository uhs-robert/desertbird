// The rule of the hold after a hint typo, shared by the pick in `hints.js` and the page keys in `pages.js`, which both listen on the window root. The background reads the hint sequences with it too.

/** A key the hold after a typo drops: a typed character with no modifier (a letter, a digit, punctuation or Space). Named keys and chords pass. */
export const is_typed_character = (event: { key: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean }): boolean => [...event.key].length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey;

/** The key sequences under a node of a compiled tree whose command starts a hint pick, as tokens. A leaf of a hint command gives `typed`. An any-key child takes keys the pick cannot know, so it adds nothing. */
export function hint_key_sequences(node: object, typed: string[] = []): string[][] {
    const { steps, children } = node as { steps?: Array<{ invocation: { id: string } }>; children?: Record<string, object> };
    if (steps?.[0]?.invocation.id.startsWith("hint.")) return [typed];
    return Object.entries(children ?? {}).flatMap(([token, child]) => (token === "" ? [] : hint_key_sequences(child, [...typed, token])));
}

/** Rewrites the sequences into the keys of a typed event, which the pick compares them with. The trees name Space `<Space>`, where the event key is " ". */
export const as_event_keys = (sequences: string[][]): string[][] => sequences.map((sequence) => sequence.map((token) => (token === "<Space>" ? " " : token)));
