/**
 * Counted things, said correctly.
 *
 * `n === 1 ? 'session' : 'sessions'` is the shape this replaces. It is right in
 * English and wrong nearly everywhere else: Polish picks a different form at 2–4
 * than at 5, Arabic has six, Japanese has one. `Intl.PluralRules` answers which
 * form a language wants for a given number, so a translation supplies the forms
 * it needs instead of the two English happens to have (forms strategy, i18n
 * readiness rule 3).
 *
 * English only needs `one` and `other`, so that is all a caller has to give
 * today — but the shape is the one a translator can extend.
 */
export interface PluralForms {
  one: string;
  other: string;
  zero?: string;
  two?: string;
  few?: string;
  many?: string;
}

const rules = new Intl.PluralRules('en');

/**
 * The form `count` calls for, without the number in front of it.
 *
 * Usually a word ("session"), but not always: where the whole sentence changes
 * shape with the count — "See the result" against "See all results" — the forms
 * are whole sentences, and picking between them is the same operation. That is
 * the point of a forms table over a `+ 's'`.
 */
export function pluralForm(count: number, forms: PluralForms): string {
  const category = rules.select(count) as keyof PluralForms;
  return forms[category] ?? forms.other;
}

/**
 * `"3 sessions"` — the count and its word, grouped for the locale.
 *
 * Pass `zero` for the cases that read better as a word than a digit ("no
 * sessions"); it is used only when the count is exactly 0, which is a copy
 * decision rather than a grammatical category.
 */
export function plural(count: number, forms: PluralForms): string {
  if (count === 0 && forms.zero !== undefined) return forms.zero;
  return `${count.toLocaleString('en-US')} ${pluralForm(count, forms)}`;
}
