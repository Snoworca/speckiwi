# CI Spec Validation Example

Use Node.js LTS for SpecKiwi validation jobs.

```sh
npm ci
npm run build
npx speckiwi validate --json
```

The validation step reads Markdown SRS documents under `docs/spec/` and does not require a database.
