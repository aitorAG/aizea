# Course workflow localization integration

The client components use `useTranslations()` and `useLocale()` from
`components/LocaleProvider.tsx`. The shared catalog is owned by the parent
integration and was not edited in this task.

## Required catalog entries

Register the literal keys used by these components in both dictionaries in
`lib/i18n.ts` before merging this work:

- `app/courses/[id]/course-detail-client.tsx`: `course.*` and `common.*`.
- `app/courses/[id]/materials/materials-client.tsx`: `materials.*` and `common.*`.
- `app/courses/[id]/figures/figure-gallery-client.tsx`: `figures.*` and `common.*`.
- `app/courses/[id]/tree/tree-client.tsx`: `tree.*` and `pipeline.*`.
- `components/TreeViewer/TreeControls.tsx`, `TreeViewer.tsx`, and
  `TreeAgentChat.tsx`, `TreeNode.tsx`, `TreeNodeTooltip.tsx`, and
  `InlineTreeNodeEditor.tsx`: `tree.*` and `common.*`.
- `components/course/icons.tsx` and `CheckpointBar.tsx`:
  `course.checkpoints.*`.
- `components/PipelineProgress/PipelineProgress.tsx` and
  `GlobalPipelineBanner.tsx`: `pipeline.*` and `common.*`.

Descriptors contain literal translation-key unions rather than unrestricted
strings. Include their `labelKey` and `descriptionKey` entries when collecting
keys; these are translated indirectly.

The translator interpolates placeholders but does not select plural forms.
Each `One`/`Many` pair must have the same placeholders, including `{count}`.
Additional interpolations are `{selected}` in tree summaries, `{name}` in the
tree editor, `{course}` in the banner, `{minutes}` in the stuck-job warning,
and `{current}`/`{total}` in the pipeline phase counter. Upload-related
interpolations are specified at the call sites. Keep Spanish catalog entries
as literal values (`as const`) so placeholder inference remains accurate.

`tree.edit.description` must include the complete save instructions (Enter
and Tab); `tree.edit.currentNode` includes the node name. Course material
dates use the active locale. User content and server-supplied error text are
displayed verbatim.

## Verification

The three existing tree/banner suites now mount a real Spanish
`LocaleProvider`, including rerenders. Latest focused run: 6 passed, 84
failed out of 90. Remaining failures occur when translating absent catalog
keys (`undefined.replace`), before behavior assertions can complete.

TypeScript likewise rejects absent keys. The apparent “Expected 2 arguments”
errors are a consequence of generic inference on invalid keys, not a
requirement to pass an empty parameter object to every translation call.

After registering the entries, run from `aizea/`:

```powershell
npx tsc --noEmit --pretty false
npx vitest run tests/unit/global-pipeline-banner.test.tsx tests/unit/tree-viewer.test.tsx tests/integration/tree-page.test.tsx
npm run build
```

Do not bypass key validation with casts or translator mocks. The package
version and i18n implementation remain under the parent integration's scope.
