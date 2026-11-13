/**
 * ChurchPro-only Semaphore adapter. No deployments, arbitrary revisions,
 * caller URLs, user-provided YAML paths, raw logs or signed artifact links.
 * Shares only the pre-existing encrypted SEMAPHORE_TOKEN binding.
 */
const API = 'https://amaraii.semaphoreci.com/api/v1alpha';
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const SHA = /^[a-f0-9]{40}$/;
export const CHURCHPRO_SEMAPHORE = Object.freeze({
  branch: 'codex/churchpro-gather-people-cells-integration-20261104',
  pipelineFile: '.semaphore/semaphore.yml',
  project: 'churchpro',
});

function projectId(env) {
  const id = env.SEMAPHORE_PROJECT_ID_CHURCH_PRO;
  if (typeof id !== 'string' || !UUID.test(id)) {
    throw Error('ChurchPro Semaphore project not configured');
  }
  return id;
}

async function semaphoreRequest(env, path, body, requestFn) {
  if (typeof env.SEMAPHORE_TOKEN !== 'string' || !env.SEMAPHORE_TOKEN) {
    throw Error('Semaphore token not configured');
  }
  const response = await requestFn(API + path, {
    method: body === undefined ? 'GET' : 'POST',
    redirect: 'manual',
    headers: {
      Authorization: 'Token ' + env.SEMAPHORE_TOKEN,
      Accept: 'application/json',
      'User-Agent': 'SemaphoreCI v2.0 Client',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw Error('ChurchPro Semaphore API HTTP ' + response.status);
  const data = await response.json();
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw Error('Invalid ChurchPro Semaphore response');
  }
  return data;
}

function enumValue(value, allowed) {
  return typeof value === 'string' && allowed.includes(value.toLowerCase())
    ? value.toLowerCase() : null;
}

const CHURCHPRO_INSPECT_ONLY_BRANCHES = Object.freeze([
  'codex/churchpro-phase2-departments-foundation-20261112',
  'codex/churchpro-phase2-department-operations-20261112',
  'codex/churchpro-p2-3h-classification-policy-20261113',
  'codex/churchpro-p2-profile-protection-policy-20261113',
  'codex/churchpro-p2-g1-private-profile-20261113',
]);
function checkedPipeline(response, expectedId, allowedBranches = [CHURCHPRO_SEMAPHORE.branch]) {
  const pipeline = response?.pipeline;
  if (!pipeline || pipeline.project_id !== expectedId ||
      !allowedBranches.includes(pipeline.branch_name) ||
      (pipeline.ppl_id !== undefined && !UUID.test(pipeline.ppl_id))) {
    throw Error('ChurchPro Semaphore pipeline ownership mismatch');
  }
  return pipeline;
}

// Semaphore logs are untrusted and can contain secret-bearing stdout.
// Return only short diagnostic patterns, never raw events or signed links.
function failureSummary(payload) {
  const events = Array.isArray(payload?.events) ? payload.events.slice(0, 4000) : [];
  let current = null;
  let lastFailure = null;
  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    if (event.event === 'cmd_started') {
      current = {
        command: typeof event.directive === 'string' ? event.directive.slice(0, 120) : '',
        output: '',
      };
    } else if (event.event === 'cmd_output' && current && typeof event.output === 'string') {
      current.output = (current.output + event.output.slice(0, 50000)).slice(-120000);
    } else if (event.event === 'cmd_finished' && current) {
      if (Number.isInteger(event.exit_code) && event.exit_code !== 0) {
        lastFailure = { ...current, exitCode: event.exit_code };
      }
      current = null;
    }
  }
  if (!lastFailure) return null;
  const redact = (value) => value
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\b(?:Bearer|Token|Authorization)\s*[:=]?\s*\S+/gi, '[redacted]')
    .replace(/\b(?:sk-|ghp_|github_pat_|semaphore_)[A-Za-z0-9_-]+/gi, '[redacted]')
    .replace(/\b[A-Za-z0-9+/_=-]{32,}\b/g, '[redacted]')
    .slice(0, 180);
  const lines = lastFailure.output.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/)
    .filter(line => /(?:\berror\b|\bwarning\b|ERR_|failed|failure|not found|not installed|command not found|TS\d{4}|TypeError|SyntaxError|AssertionError|cannot |denied|invalid |unsupported |malformed|BROWSER_CASE_(?:FAIL|DIAGNOSTIC)|QA_INTEL_API|✖|^\s*●\s+|\bExpected:|\bReceived:|expected\s+\d{3}|got\s+\d{3}|Test Suites:|Tests:)/i.test(line))
    .filter(line => !/(?:API[_-]?KEY|SECRET|PASSWORD|TOKEN|AUTHORIZATION|PRIVATE[_-]?KEY)\s*[:=]/i.test(line))
    .slice(-22).map(redact);
  const failedTestCases = lastFailure.output.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/)
    .filter(line => /^\s*●\s+Phase 2 Department API:/i.test(line))
    .slice(-6).map(redact);
  return {
    command: redact(lastFailure.command),
    exitCode: lastFailure.exitCode,
    diagnosticLines: [...new Set(lines)],
    ...(failedTestCases.length ? { failedTestCases: [...new Set(failedTestCases)] } : {}),
  };
}

const CHURCHPRO_QA_REPORTS = Object.freeze([
  'qa-intel/churchpro/agent-handoff.json',
  'qa-intel/churchpro/gather-browser-handoff.json',
]);
const REPORT_MAX_BYTES = 65536;
function trustedArtifactHost(value) {
  let url;
  try { url = new URL(value); } catch { throw Error('Invalid artifact location'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !(host === 'storage.googleapis.com' || host.endsWith('.storage.googleapis.com') ||
        host === 's3.amazonaws.com' || host.endsWith('.s3.amazonaws.com') ||
        /^[a-z0-9.-]+\.s3\.[a-z0-9-]+\.amazonaws\.com$/.test(host) ||
        host === 'artifacts.semaphoreci.com' || host.endsWith('.artifacts.semaphoreci.com') ||
        host.endsWith('.r2.cloudflarestorage.com'))) {
    throw Error('Invalid artifact location');
  }
  return url;
}
async function downloadSanitizedReport(value, requestFn) {
  let url = trustedArtifactHost(value);
  for (let redirects = 0; redirects < 3; redirects++) {
    const response = await requestFn(url.toString(), {
      method: 'GET', redirect: 'manual', headers: { Accept: 'application/json' },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw Error('Artifact download failed');
      url = trustedArtifactHost(new URL(location, url).toString());
      continue;
    }
    if (!response.ok || !response.body) throw Error('Artifact download failed');
    const announced = Number(response.headers.get('content-length') || 0);
    if (!Number.isFinite(announced) || announced > REPORT_MAX_BYTES) throw Error('Report too large');
    const reader = response.body.getReader();
    const chunks = [];
    let count = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      count += value.length;
      if (count > REPORT_MAX_BYTES) {
        await reader.cancel();
        throw Error('Report too large');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(count);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    try { return JSON.parse(new TextDecoder().decode(bytes)); }
    catch { throw Error('Invalid sanitized QA report'); }
  }
  throw Error('Artifact download failed');
}

function pngBase64(bytes) {
  let binary = '';
  for (let n = 0; n < bytes.length; n += 16384) {
    binary += String.fromCharCode(...bytes.subarray(n, n + 16384));
  }
  return btoa(binary);
}
async function downloadBoundedPng(signedUrl, requestFn) {
  let url = trustedArtifactHost(signedUrl);
  const maxBytes = 2_500_000;
  for (let redirects = 0; redirects < 3; redirects++) {
    const res = await requestFn(url.toString(), { method: 'GET',
      redirect: 'manual', headers: { Accept: 'image/png' } });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get('location');
      if (!location) throw Error('ChurchPro PNG download failed');
      url = trustedArtifactHost(new URL(location, url).toString());
      continue;
    }
    if (!res.ok || !res.body) throw Error('ChurchPro PNG download failed');
    const announced = Number(res.headers.get('content-length') || 0);
    if (!Number.isFinite(announced) || announced > maxBytes) throw Error('ChurchPro PNG too large');
    const reader = res.body.getReader(), chunks = [];
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) { await reader.cancel(); throw Error('ChurchPro PNG too large'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    if (length < 33 || ![137,80,78,71,13,10,26,10].every((n,i) => bytes[i] === n) ||
        String.fromCharCode(...bytes.subarray(12,16)) !== 'IHDR') {
      throw Error('ChurchPro PNG format mismatch');
    }
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = dv.getUint32(16), height = dv.getUint32(20);
    if (width < 320 || width > 2500 || height < 200 || height > 30000) {
      throw Error('ChurchPro PNG dimensions invalid');
    }
    return { width, height, bytes: length, dataBase64: pngBase64(bytes) };
  }
  throw Error('ChurchPro PNG redirect limit');
}

function safeIntent(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,110}$/.test(value)
    ? value : 'redacted';
}
function summaryFromReport(data, path, revision) {
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      data.schemaVersion !== 1 && path.endsWith('agent-handoff.json')) {
    throw Error('Invalid sanitized QA report');
  }
  if (path.endsWith('agent-handoff.json')) {
    if (data.project !== 'churchpro' || data.product !== 'ChurchPro' ||
        data.revision !== revision || !Array.isArray(data.checks) ||
        data.checks.length > 100) throw Error('QA report source mismatch');
    const failed = data.checks.filter(entry => entry?.status !== 'passed');
    return {
      type: 'qa-intel-api',
      status: data.evidenceStatus === 'passed' ? 'passed' : 'failed',
      passed: data.checks.length - failed.length,
      total: data.checks.length,
      failed: failed.slice(0, 30).map(entry => ({
        intent: safeIntent(entry?.intent),
        status: entry?.status === 'not_executed' ? 'not_executed' : 'failed',
        ...(typeof entry?.diagnostic === 'string' ? { diagnostic: safeIntent(entry.diagnostic) } : {}),
      })),
    };
  }
  if (data.sourceSha !== revision || data.evidence !== 'disposable-real-postgresql-nest-browser' ||
      !Array.isArray(data.cases) || data.cases.length > 50) {
    throw Error('Browser report source mismatch');
  }
  const failed = data.cases.filter(entry => entry?.status !== 'passed');
  return {
    type: 'gather-browser',
    status: data.status === 'passed' ? 'passed' : 'failed',
    passed: data.cases.length - failed.length,
    total: data.cases.length,
    failed: failed.slice(0, 30).map(entry => ({
      intent: safeIntent(entry?.id),
      status: 'failed',
      ...(typeof entry?.kind === 'string' ? { diagnostic: safeIntent(entry.kind) } : {}),
    })),
  };
}

/** A private Queue caller must use explicit, validated project + action. */
export async function executeSemaphoreChurchPro(env, command, requestFn = fetch) {
  if (command.project !== CHURCHPRO_SEMAPHORE.project || command.provider !== 'semaphore') {
    throw Error('ChurchPro Semaphore routing mismatch');
  }
  if (command.action === 'health') {
    return {
      provider: 'semaphore',
      project: CHURCHPRO_SEMAPHORE.project,
      tokenConfigured: typeof env.SEMAPHORE_TOKEN === 'string' && !!env.SEMAPHORE_TOKEN,
      projectConfigured: UUID.test(env.SEMAPHORE_PROJECT_ID_CHURCH_PRO ?? ''),
      allowedBranches: [CHURCHPRO_SEMAPHORE.branch],
      availableModes: ['validation'],
      allowedActions: ['health', 'trigger', 'inspect', 'churchpro_report', 'churchpro_artifact_probe', 'churchpro_png'],
    };
  }
  const id = projectId(env);
  if (command.action === 'trigger') {
    if (command.branch !== CHURCHPRO_SEMAPHORE.branch ||
        command.mode !== 'validation' ||
        typeof command.commitSha !== 'string' || !SHA.test(command.commitSha)) {
      throw Error('ChurchPro Semaphore revision not permitted');
    }
    const response = await semaphoreRequest(env, '/plumber-workflows', {
      project_id: id,
      reference: 'refs/heads/' + CHURCHPRO_SEMAPHORE.branch,
      commit_sha: command.commitSha,
      pipeline_file: CHURCHPRO_SEMAPHORE.pipelineFile,
    }, requestFn);
    if (!UUID.test(response.workflow_id ?? '') || !UUID.test(response.pipeline_id ?? '')) {
      throw Error('Invalid ChurchPro Semaphore response');
    }
    return {
      provider: 'semaphore',
      project: CHURCHPRO_SEMAPHORE.project,
      mode: 'validation',
      branch: CHURCHPRO_SEMAPHORE.branch,
      requestedRevision: command.commitSha,
      pipelineId: response.pipeline_id,
      workflowId: response.workflow_id,
    };
  }
  if (command.action === 'churchpro_png') {
    const allowed = /^(?:people-390|navigation-390|cells-390|church-1280|people-1280|people-320|church-768|cells-1440|people-dark-1280|person-detail-390|cell-roster-390|staff-1280|staff-removed-1280)\.png$/u;
    const file = typeof command.artifactPath === 'string' &&
      command.artifactPath.startsWith('visual-review/')
      ? command.artifactPath.slice('visual-review/'.length) : '';
    if (!UUID.test(command.pipelineId ?? '') || !UUID.test(command.jobId ?? '') ||
        !allowed.test(file)) throw Error('ChurchPro PNG access not permitted');
    const base = await semaphoreRequest(env, '/pipelines/' + command.pipelineId,
      undefined, requestFn);
    const pipeline = checkedPipeline(base, id);
    if (pipeline.ppl_id && pipeline.ppl_id !== command.pipelineId ||
        !SHA.test(pipeline.commit_sha ?? '') || !UUID.test(pipeline.wf_id ?? '')) {
      throw Error('ChurchPro PNG ownership mismatch');
    }
    const details = await semaphoreRequest(env, '/pipelines/' + command.pipelineId +
      '?detailed=true', undefined, requestFn);
    if (!details?.pipeline || details.pipeline.wf_id &&
        details.pipeline.wf_id !== pipeline.wf_id ||
        details.pipeline.project_id && details.pipeline.project_id !== id) {
      throw Error('ChurchPro PNG ownership mismatch');
    }
    const jobs = (Array.isArray(details.blocks) ? details.blocks : [])
      .flatMap(block => Array.isArray(block.jobs) ? block.jobs : []);
    if (!jobs.some(job => job?.job_id === command.jobId &&
        job?.result?.toLowerCase() === 'passed')) {
      throw Error('ChurchPro PNG job ownership mismatch');
    }
    const scope = '?scope=jobs&scope_id=' + command.jobId;
    const listing = await semaphoreRequest(env, '/artifacts' + scope +
      '&path=visual-review', undefined, requestFn);
    const paths = Array.isArray(listing.artifacts) ? listing.artifacts : [];
    const target = paths.find(entry => entry?.path === command.artifactPath &&
      !entry.is_directory);
    const manifestEntry = paths.find(entry => entry?.path === 'visual-review/manifest.json' &&
      !entry.is_directory);
    if (!target || !manifestEntry || (Number.isInteger(target.size) &&
        (target.size < 33 || target.size > 2_500_000)) ||
        (Number.isInteger(manifestEntry.size) &&
        (manifestEntry.size < 2 || manifestEntry.size > REPORT_MAX_BYTES))) {
      throw Error('ChurchPro PNG artifact unavailable');
    }
    const signedPath = async path => {
      const data = await semaphoreRequest(env, '/artifacts/signed_url' +
        scope + '&path=' + encodeURIComponent(path) + '&method=GET',
        undefined, requestFn);
      const signed = (Array.isArray(data.items) ? data.items : [])
        .find(item => item.path === path && typeof item.url === 'string');
      if (!signed) throw Error('ChurchPro PNG signature unavailable');
      return signed.url;
    };
    const manifest = await downloadSanitizedReport(
      await signedPath('visual-review/manifest.json'), requestFn);
    if (!manifest || manifest.sourceSha !== pipeline.commit_sha ||
        manifest.fixture !== 'disposable-synthetic' || manifest.status !== 'passed' ||
        !Array.isArray(manifest.files) || !manifest.files.includes(file)) {
      throw Error('ChurchPro PNG provenance mismatch');
    }
    const image = await downloadBoundedPng(await signedPath(command.artifactPath), requestFn);
    return { provider:'semaphore', project:'churchpro',
      pipelineId:command.pipelineId, revision:pipeline.commit_sha,
      path:command.artifactPath, mediaType:'image/png', ...image };
  }

  if (command.action === 'churchpro_artifact_probe') {
    if (!UUID.test(command.pipelineId ?? '') || !UUID.test(command.jobId ?? '')) {
      throw Error('ChurchPro artifact probe not permitted');
    }
    // Verify actual Semaphore pipeline ownership before any job/artifact reads.
    const basics = await semaphoreRequest(env, '/pipelines/' + command.pipelineId,
      undefined, requestFn);
    const pipeline = checkedPipeline(basics, id);
    if (pipeline.ppl_id && pipeline.ppl_id !== command.pipelineId ||
        !SHA.test(pipeline.commit_sha ?? '') || !UUID.test(pipeline.wf_id ?? '')) {
      throw Error('ChurchPro artifact probe ownership mismatch');
    }
    const details = await semaphoreRequest(env, '/pipelines/' + command.pipelineId +
      '?detailed=true', undefined, requestFn);
    if (!details?.pipeline ||
        details.pipeline.wf_id && details.pipeline.wf_id !== pipeline.wf_id ||
        details.pipeline.project_id && details.pipeline.project_id !== id) {
      throw Error('ChurchPro artifact probe ownership mismatch');
    }
    const jobs = (Array.isArray(details.blocks) ? details.blocks : [])
      .flatMap(block => Array.isArray(block.jobs) ? block.jobs : []);
    if (!jobs.some(job => job?.job_id === command.jobId)) {
      throw Error('ChurchPro artifact probe ownership mismatch');
    }
    // Only probe fixed root/prefix paths. Do not return arbitrary filenames,
    // raw logs, signed URLs, hidden secrets or data from a foreign project.
    const probes = [
      { scope: 'jobs', scopeId: command.jobId, path: '' },
      { scope: 'jobs', scopeId: command.jobId, path: 'qa-intel' },
      { scope: 'jobs', scopeId: command.jobId, path: 'qa-intel/churchpro' },
      { scope: 'jobs', scopeId: command.jobId, path: 'visual-review' },
      { scope: 'workflows', scopeId: pipeline.wf_id, path: '' },
    ];
    const artifacts = [];
    for (const probe of probes) {
      const params = new URLSearchParams({ scope: probe.scope,
        scope_id: probe.scopeId, ...(probe.path ? { path: probe.path } : {}) });
      try {
        const data = await semaphoreRequest(env, '/artifacts?' + params.toString(),
          undefined, requestFn);
        const children = Array.isArray(data.artifacts) ? data.artifacts : [];
        artifacts.push({ scope: probe.scope, path: probe.path || '(root)',
          http: 200, count: children.length,
          entries: children.slice(0, 24).map(e => ({
            file: typeof e?.name === 'string' &&
              /^(?:qa-intel|churchpro|visual-review|manifest\.json|agent-handoff\.json|gather-browser-handoff\.json|[a-z0-9-]{1,50}\.png)$/u.test(e.name)
              ? e.name : '(other)',
            directory: e?.is_directory === true,
          })) });
      } catch (error) {
        const m = /ChurchPro Semaphore API HTTP (\d{3})/u.exec(String(error));
        artifacts.push({ scope: probe.scope, path: probe.path || '(root)',
          http: m ? Number(m[1]) : 0 });
      }
    }
    let upload = { commandSeen: false, finished: false, failed: false,
      reportedCount: 0 };
    try {
      const logs = await semaphoreRequest(env, '/logs/' + command.jobId,
        undefined, requestFn);
      const events = Array.isArray(logs.events) ? logs.events.slice(-5000) : [];
      let activeUpload = false;
      for (const event of events) {
        if (event?.event === 'cmd_started') {
          activeUpload = typeof event.directive === 'string' &&
            /(?:^|\s)artifact\s+push\s+(?:job|workflow)\s/iu.test(event.directive);
          if (activeUpload) upload.commandSeen = true;
        } else if (event?.event === 'cmd_finished' && activeUpload) {
          upload.finished = true;
          if (event.exit_code !== 0) upload.failed = true;
          activeUpload = false;
        } else if (event?.event === 'cmd_output' && activeUpload) {
          if (typeof event.output === 'string' &&
              /(?:error|failed|not found|forbidden|unauthorized|upload)/iu.test(event.output)) {
            upload.reportedCount = Math.min(30, upload.reportedCount + 1);
          }
        }
      }
    } catch { /* Return root artifact statuses even if logs are unavailable. */ }
    return { provider: 'semaphore', project: 'churchpro',
      pipelineId: command.pipelineId, jobId: command.jobId,
      revision: pipeline.commit_sha, artifacts, upload };
  }
  if (command.action === 'churchpro_report') {
    if (!UUID.test(command.pipelineId ?? '') || !UUID.test(command.jobId ?? '') ||
        !CHURCHPRO_QA_REPORTS.includes(command.artifactPath)) {
      throw Error('ChurchPro report access not permitted');
    }
    const basics = await semaphoreRequest(env, '/pipelines/' + command.pipelineId,
      undefined, requestFn);
    const pipeline = checkedPipeline(basics, id);
    if (pipeline.ppl_id && pipeline.ppl_id !== command.pipelineId) {
      throw Error('ChurchPro pipeline identity mismatch');
    }
    if (!SHA.test(pipeline.commit_sha ?? '')) throw Error('ChurchPro source identity missing');
    const details = await semaphoreRequest(env, '/pipelines/' + command.pipelineId +
      '?detailed=true', undefined, requestFn);
    const detailed = details?.pipeline;
    if (!detailed || (detailed.project_id && detailed.project_id !== id) ||
        (detailed.branch_name && detailed.branch_name !== CHURCHPRO_SEMAPHORE.branch) ||
        (detailed.ppl_id && detailed.ppl_id !== command.pipelineId) ||
        (detailed.wf_id && detailed.wf_id !== pipeline.wf_id)) {
      throw Error('ChurchPro workflow identity mismatch');
    }
    const jobs = (Array.isArray(details.blocks) ? details.blocks : [])
      .flatMap(block => Array.isArray(block.jobs) ? block.jobs : []);
    const job = jobs.find(item => item?.job_id === command.jobId);
    if (!job) throw Error('ChurchPro QA job ownership mismatch');
    const scope = '?scope=jobs&scope_id=' + command.jobId;
    // Semaphore's artifact push job stores the basename at the job root.
    const actualPath = command.artifactPath.slice('qa-intel/churchpro/'.length);
    const listing = await semaphoreRequest(env, '/artifacts' + scope,
      undefined, requestFn);
    const record = (Array.isArray(listing.artifacts) ? listing.artifacts : [])
      .find(entry => entry.path === actualPath && entry.is_directory === false);
    if (!record || (Number.isInteger(record.size) &&
        (record.size < 0 || record.size > REPORT_MAX_BYTES))) throw Error('QA artifact unavailable');
    const result = await semaphoreRequest(env, '/artifacts/signed_url' + scope +
      '&path=' + encodeURIComponent(actualPath) + '&method=GET',
      undefined, requestFn);
    const signed = (Array.isArray(result.items) ? result.items : [])
      .find(item => item.path === actualPath && typeof item.url === 'string');
    if (!signed) throw Error('QA artifact unavailable');
    const data = await downloadSanitizedReport(signed.url, requestFn);
    return {
      provider: 'semaphore',
      project: 'churchpro',
      pipelineId: command.pipelineId,
      revision: pipeline.commit_sha,
      ...summaryFromReport(data, command.artifactPath, pipeline.commit_sha),
    };
  }
  if (command.action === 'inspect') {
    if (!UUID.test(command.pipelineId ?? '')) throw Error('Invalid ChurchPro pipeline identity');
    const base = await semaphoreRequest(env, '/pipelines/' + command.pipelineId,
      undefined, requestFn);
    const pipeline = checkedPipeline(base, id, [CHURCHPRO_SEMAPHORE.branch, ...CHURCHPRO_INSPECT_ONLY_BRANCHES]);
    if (pipeline.ppl_id && pipeline.ppl_id !== command.pipelineId) {
      throw Error('ChurchPro Semaphore pipeline identity mismatch');
    }
    const details = await semaphoreRequest(env, '/pipelines/' + command.pipelineId +
      '?detailed=true', undefined, requestFn);
    // Semaphore's detailed response may omit repeated project/branch metadata.
    // The basic response above is mandatory and already establishes ownership.
    const detailed = details?.pipeline;
    if (!detailed ||
        (detailed.project_id && detailed.project_id !== id) ||
        (detailed.branch_name && detailed.branch_name !== pipeline.branch_name) ||
        (detailed.ppl_id && detailed.ppl_id !== command.pipelineId) ||
        (detailed.wf_id && detailed.wf_id !== pipeline.wf_id)) {
      throw Error('ChurchPro Semaphore workflow identity mismatch');
    }
    const blocks = (Array.isArray(details.blocks) ? details.blocks : []).slice(0, 12)
      .map(block => ({
        name: typeof block.name === 'string' ? block.name.slice(0, 100) : null,
        state: enumValue(block.state, ['pending', 'running', 'done', 'stopped', 'queued']),
        result: enumValue(block.result, ['passed', 'failed', 'stopped', 'canceled', 'skipped']),
        jobs: (Array.isArray(block.jobs) ? block.jobs : []).slice(0, 15).map(job => ({
          id: UUID.test(job.job_id ?? '') ? job.job_id : null,
          name: typeof job.name === 'string' ? job.name.slice(0, 100) : null,
          status: enumValue(job.status, ['queued', 'pending', 'running', 'finished', 'stopped']),
          result: enumValue(job.result, ['passed', 'failed', 'stopped', 'canceled', 'skipped']),
        })),
      }));
    const failedJobs = blocks.flatMap(block => block.jobs)
      .filter(job => job.id && job.result === 'failed').slice(0, 3);
    const failures = [];
    for (const job of failedJobs) {
      try {
        const logs = await semaphoreRequest(env, '/logs/' + job.id, undefined, requestFn);
        failures.push({ jobId: job.id, ...(
          failureSummary(logs) ?? { diagnostic: 'No failed-command diagnostic available' }
        ) });
      } catch {
        failures.push({ jobId: job.id, diagnostic: 'Failed-job logs unavailable' });
      }
    }
    if (failures.length === 0 && pipeline.result === 'failed') {
      failures.push({ diagnostic: 'Pipeline failed before a job-level error could be identified' });
    }
    return {
      ...(failures.length ? { failure: failures[0], failures } : {}),
      provider: 'semaphore',
      project: CHURCHPRO_SEMAPHORE.project,
      pipelineId: command.pipelineId,
      workflowId: UUID.test(pipeline.wf_id ?? '') ? pipeline.wf_id : null,
      state: enumValue(pipeline.state, ['pending', 'running', 'done', 'stopping', 'stopped', 'queued']),
      result: enumValue(pipeline.result, ['passed', 'failed', 'stopped', 'canceled', 'skipped']),
      vcs: {
        branch: pipeline.branch_name,
        revision: SHA.test(pipeline.commit_sha ?? '') ? pipeline.commit_sha : null,
      },
      blocks,
    };
  }
  throw Error('ChurchPro Semaphore action not permitted');
}
