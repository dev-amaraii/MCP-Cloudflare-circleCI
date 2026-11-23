/**
 * Read-only, exact-job ChurchPro P3.2b lookup failure classification.
 * Never return source stdout, arbitrary test messages, Person names, request
 * queries, auth values, URLs or any opaque CI artifact. The trusted job+SHA
 * lookup is independently verified by the existing job_steps handler.
 */
const PIN = Object.freeze({
  jobs: Object.freeze({
    'c2119a08-51c7-4c1f-9344-3c79408fdfa6': Object.freeze({ pipelineId: '0a9f358e-5947-4737-99ca-50cebc4a99fa', number: 1224, step: 107, label: 'database' }),
    '5409d92d-ead1-424a-b3a2-6c09a9cfb477': Object.freeze({ pipelineId: '0a9f358e-5947-4737-99ca-50cebc4a99fa', number: 1231, step: 111, label: 'api' }),
    'e85b9940-36d2-45cb-84ee-92bec7e3ec4e': Object.freeze({ pipelineId: '90b99a1f-1f3e-48c7-94f4-ca8adba8043c', number: 1241, step: 111, label: 'api' }),
  }),
});

export function summarizePinnedChurchProLookupFailure(raw, command, failedStep) {
  if (!command || command.project !== 'churchpro' ||
      command.provider !== 'circleci') return null;
  const job = PIN.jobs[command.jobId];
  if (!job || command.pipelineId !== job.pipelineId ||
      command.jobNumber !== job.number || failedStep !== job.step) return null;

  const text = String(raw || '').slice(-180000).replace(/\x1b\[[0-9;]*[A-Za-z]/gu, '');
  const kinds = [];
  const flags = [
    ['assertion_mismatch', /AssertionError|expected .* to (?:equal|be|contain|match)|expect\(/iu],
    ['module_resolution', /Cannot find module|Failed to resolve import|ERR_MODULE_NOT_FOUND|No matching export/iu],
    ['postgres_query_error', /error:\s*(?:syntax error|operator does not exist|function .* does not exist)|PostgresError|DatabaseError/iu],
    ['migration_failure', /migration failed|drizzle.*migrat|Migration failed/iu],
    ['trigram_index_related', /people_active_lower_full_name_trgm_idx|gin_trgm_ops|pg_trgm/iu],
    ['query_plan_related', /EXPLAIN|query plan|Seq Scan|Bitmap Index Scan/iu],
    ['database_unit_related', /attendance-capture-store\.test\.ts/iu],
    ['migration_history_related', /migration-history\.test\.ts/iu],
    ['api_literal_index_test_related', /P3\.2b literal candidate query escapes LIKE metacharacters/iu],
    ['timeout_or_resource', /Timed out|timeout exceeded|ENOMEM|SIGKILL|OOMKilled/iu],
  ];
  for (const [label, pattern] of flags) if (pattern.test(text)) kinds.push(label);
  const tests = [];
  const recognized = [
    ['literal_escape_unit', /(?:FAIL|×|✗|●|❯)[^\r\n]*escapes wildcard and escape metacharacters/iu],
    ['injection_literal_unit', /(?:FAIL|×|✗|●|❯)[^\r\n]*never interpolates untrusted input/iu],
    ['migration_history_unit', /(?:FAIL|×|✗|●|❯)[^\r\n]*registers every SQL file exactly once/iu],
    ['literal_index_api', /(?:FAIL|×|✗|●|❯)[^\r\n]*literal candidate query escapes LIKE metacharacters/iu],
  ];
  for (const [label, pattern] of recognized) if (pattern.test(text)) tests.push(label);
  const codes = [...new Set(text.match(/\b(?:TS\d{4}|42P01|42601|42704|42883|23505|23514)\b/gu) || [])].slice(0,8);
  return {
    sourcePin: 'churchpro-p32b-lookup-00f545e4',
    job: job.label,
    failedTestIds: tests,
    diagnosticClasses: kinds,
    sqlStateOrTsCodes: codes,
    hasTestOutput: text.length > 0,
    outputLengthClass: text.length > 100000 ? 'large' : 'bounded',
  };
}
