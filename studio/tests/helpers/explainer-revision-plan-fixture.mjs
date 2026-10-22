// Synthetic, independently enumerated visual contract. Do not derive this
// fixture from VISUALS or load any episode, production plan, or output.
export function createExplainerRevisionPlanFixture() {
  return {
    schemaVersion: 'explainer-revision-plan-v1',
    chapters: [
      {id: 'concept', label: '01 · Synthetic concept'},
      {id: 'types', label: '02 · Synthetic types'},
      {id: 'relationship', label: '03 · Synthetic relationship'},
      {id: 'practice', label: '04 · Synthetic practice'}
    ],
    clips: [
      {id: 'fixture-overview', segments: [
        {id: 'overview-01', visual: 'topic', chapterId: 'concept'},
        {id: 'overview-02', visual: 'outline', chapterId: 'concept'},
        {id: 'overview-03', visual: 'context', chapterId: 'concept'},
        {id: 'overview-04', visual: 'sources', chapterId: 'concept'},
        {id: 'overview-05', visual: 'memory', chapterId: 'concept'},
        {id: 'overview-06', visual: 'scope', chapterId: 'types'},
        {id: 'overview-07', visual: 'types', chapterId: 'types'},
        {id: 'overview-08', visual: 'type-examples', chapterId: 'types'},
        {id: 'overview-09', visual: 'two-dimensions', chapterId: 'types'},
        {id: 'overview-10', visual: 'authorized-read', chapterId: 'relationship'},
        {id: 'overview-11', visual: 'relationship', chapterId: 'relationship'}
      ]},
      {id: 'fixture-request', segments: [
        {id: 'request-01', visual: 'case', chapterId: 'practice'},
        {id: 'request-02', visual: 'case-policy', chapterId: 'practice'},
        {id: 'request-03', visual: 'request', chapterId: 'practice'},
        {id: 'request-04', visual: 'constraint', chapterId: 'practice'},
        {id: 'request-05', visual: 'access', chapterId: 'practice'},
        {id: 'request-06', visual: 'fresh-query', chapterId: 'practice'},
        {id: 'request-07', visual: 'policy', chapterId: 'practice'},
        {id: 'request-08', visual: 'model-input', chapterId: 'practice'},
        {id: 'request-09', visual: 'compression', chapterId: 'practice'},
        {id: 'request-10', visual: 'answer-fact', chapterId: 'practice'},
        {id: 'request-11', visual: 'answer-limit', chapterId: 'practice'},
        {id: 'request-12', visual: 'answer-next', chapterId: 'practice'},
        {id: 'request-13', visual: 'session-record', chapterId: 'practice'},
        {id: 'request-14', visual: 'memory-record', chapterId: 'practice'}
      ]},
      {id: 'fixture-write-and-test', segments: [
        {id: 'write-01', visual: 'write-compare', chapterId: 'practice'},
        {id: 'write-02', visual: 'sync-write', chapterId: 'practice'},
        {id: 'write-03', visual: 'async-receipt', chapterId: 'practice'},
        {id: 'write-04', visual: 'async-write', chapterId: 'practice'},
        {id: 'write-05', visual: 'test-outline', chapterId: 'practice'},
        {id: 'write-06', visual: 'test-freshness', chapterId: 'practice'},
        {id: 'write-07', visual: 'test-access', chapterId: 'practice'},
        {id: 'write-08', visual: 'test-unavailable', chapterId: 'practice'},
        {id: 'write-09', visual: 'test-evidence', chapterId: 'practice'}
      ]}
    ]
  };
}
