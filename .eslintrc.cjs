/* eslint-env node */

/**
 * i18n readiness, rule 1 of the forms strategy: logical properties everywhere,
 * so RTL later costs a `dir` attribute rather than a second pass over every call
 * site. In LTR these render identically to the physical ones, so the rule is
 * free today and expensive to retrofit — which is exactly why it is a rule and
 * not a preference. Matches class tokens both in plain strings and in template
 * literals (`className={`… ${x}`}`).
 */
const PHYSICAL = String.raw`(^|\s)-?(pl|pr|ml|mr|left|right)-[a-z0-9[]`;
const TEXT_ALIGN = String.raw`(^|\s)text-(left|right)(\s|$)`;
const LOGICAL_MESSAGE =
  'Use the logical property: ps-/pe-, ms-/me-, start-/end-, text-start/text-end. ' +
  'Physical left/right utilities are banned so RTL stays one `dir` away — forms strategy, i18n readiness.';

const logicalProperties = [
  { selector: `Literal[value=/${PHYSICAL}/]`, message: LOGICAL_MESSAGE },
  { selector: `TemplateElement[value.raw=/${PHYSICAL}/]`, message: LOGICAL_MESSAGE },
  { selector: `Literal[value=/${TEXT_ALIGN}/]`, message: LOGICAL_MESSAGE },
  { selector: `TemplateElement[value.raw=/${TEXT_ALIGN}/]`, message: LOGICAL_MESSAGE },
];

/** The two old field skins: `inputClass` went in Phase 2, `selectClass` with
 *  the last native `<select>` in the Base UI migration. */
const noOldSkins = {
  selector: "VariableDeclarator[id.name=/^(inputClass|selectClass)$/]",
  message:
    'The old field skins are gone. Use <ControlShell> + <TextInput> for a text field, or <Select> from components/ui/select for a dropdown.',
};

/** Every dropdown is a Base UI Select now, themed to the fields. A native one
 *  would be the only control in the app not wearing the field's border, height
 *  and focus ring — which is the inconsistency the migration existed to fix. */
const noNativeSelect = {
  selector: "JSXOpeningElement[name.name='select']",
  message:
    'Use <Select> from components/ui/select. Raw <select> is banned — every dropdown is a Base UI Select (see the shadcn/Base UI migration).',
};

module.exports = {
  root: true,
  env: { es2022: true, node: true, browser: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } },
  plugins: ['@typescript-eslint', 'react-hooks'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  rules: {
    ...require('eslint-plugin-react-hooks').configs.recommended.rules,
    // Handlers legitimately return promises we deliberately don't await.
    '@typescript-eslint/no-misused-promises': 'off',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    'no-console': ['warn', { allow: ['warn', 'error', 'log'] }],
    eqeqeq: ['error', 'smart'],
  },
  overrides: [
    {
      // The forms overhaul (Phase 2) put every text field behind the `ui.tsx`
      // primitives so the border, height, focus ring, 16px-on-mobile fix and
      // aria wiring live in one place. These rules stop the next edit from
      // hand-rolling one again. `ui.tsx` is where the primitives legitimately
      // use the raw elements, so it is excluded from the element bans.
      files: ['web/src/**/*.{ts,tsx}'],
      excludedFiles: ['web/src/components/ui.tsx'],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector: "JSXOpeningElement[name.name='input']",
            message:
              'Use <TextInput> inside a <ControlShell> for a text field. A native checkbox/radio/color/file/search input is fine with an inline eslint-disable saying which. Raw <input> outside ui.tsx is banned — see the forms overhaul.',
          },
          {
            selector: "JSXOpeningElement[name.name='textarea']",
            message: 'Use <TextArea> from ui.tsx. Raw <textarea> outside ui.tsx is banned.',
          },
          noNativeSelect,
          noOldSkins,
          ...logicalProperties,
        ],
      },
    },
    {
      // `ui.tsx` and `ui/select.tsx` are where the primitives legitimately use
      // the raw elements, so only the class-level rules apply to them.
      files: ['web/src/components/ui.tsx', 'web/src/components/ui/*.tsx'],
      rules: {
        'no-restricted-syntax': ['error', noOldSkins, ...logicalProperties],
      },
    },
  ],
  ignorePatterns: [
    'node_modules/',
    'server/dist/',
    'web/dist/',
    'data/',
    // The approved mockup is a reference artefact, not shipped source.
    'design/mockup.jsx',
  ],
};
