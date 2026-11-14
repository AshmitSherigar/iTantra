export type TextAccuracy = {
  referenceWords: number;
  wordEdits: number;
  wordErrorRate: number | null;
  referenceCharacters: number;
  characterEdits: number;
  characterErrorRate: number | null;
};

function editDistance<T>(reference: T[], hypothesis: T[]): number {
  let previous = Array.from({ length: hypothesis.length + 1 }, (_, i) => i);
  for (let i = 1; i <= reference.length; i++) {
    const current = [i];
    for (let j = 1; j <= hypothesis.length; j++) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (reference[i - 1] === hypothesis[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[hypothesis.length];
}

function normalize(text: string): string {
  return text
    .normalize('NFC')
    .toLocaleLowerCase()
    .replace(/[.,!?;:()[\]{}"'।॥]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Word and Unicode-code-point error rates against operator-provided truth. */
export function calculateTextAccuracy(
  referenceText: string,
  hypothesisText: string,
): TextAccuracy {
  const reference = normalize(referenceText);
  const hypothesis = normalize(hypothesisText);
  const referenceWords = reference ? reference.split(' ') : [];
  const hypothesisWords = hypothesis ? hypothesis.split(' ') : [];
  const referenceChars = Array.from(reference);
  const hypothesisChars = Array.from(hypothesis);
  const wordEdits = editDistance(referenceWords, hypothesisWords);
  const characterEdits = editDistance(referenceChars, hypothesisChars);
  return {
    referenceWords: referenceWords.length,
    wordEdits,
    wordErrorRate:
      referenceWords.length > 0 ? wordEdits / referenceWords.length : null,
    referenceCharacters: referenceChars.length,
    characterEdits,
    characterErrorRate:
      referenceChars.length > 0 ? characterEdits / referenceChars.length : null,
  };
}
