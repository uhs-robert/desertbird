// The labels of the hint keys. The body script uses them now. A hint mode in the mail window can use the same alphabet and generator, so the two never differ.

/** Home row first, so the most typed labels sit under the fingers. Every letter is lower case, and a typed letter is lowered before it is compared. A custom alphabet must be lower case too: the `hint_letters` setting is lowered where it is read. */
export const HINT_ALPHABET = "asdfghjkl";

/** One label per target, all of the same length, so no label starts another and a typed prefix with one match is final. */
export function hint_labels(count: number, alphabet: string = HINT_ALPHABET): string[] {
    let length = 1;
    while (alphabet.length ** length < count) length++;
    return Array.from({ length: count }, (_, index) => {
        let label = "";
        for (let rest = index, place = 0; place < length; place++, rest = Math.floor(rest / alphabet.length)) label = alphabet[rest % alphabet.length]! + label;
        return label;
    });
}

/** The labels that start with what was typed. */
export const labels_matching = (labels: readonly string[], typed: string): string[] => labels.filter((label) => label.startsWith(typed));
