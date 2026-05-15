const els = {
  pipelineUrl: document.getElementById('pipelineUrl'),
  gitlabBaseUrl: document.getElementById('gitlabBaseUrl'),
  token: document.getElementById('token'),
  rememberToken: document.getElementById('rememberToken'),
  loadBtn: document.getElementById('loadBtn'),
  exportBtn: document.getElementById('exportBtn'),
  zoomOutBtn: document.getElementById('zoomOutBtn'),
  zoomInBtn: document.getElementById('zoomInBtn'),
  status: document.getElementById('status'),
  summaryPanel: document.getElementById('summaryPanel'),
  timelinePanel: document.getElementById('timelinePanel'),
  summary: document.getElementById('summary'),
  timeline: document.getElementById('timeline'),
};

let lastResult = null;
let timelineZoom = 1;

init();

function init() {
  const savedToken = localStorage.getItem('gitlabTimelineToken');
  if (savedToken) {
    els.token.value = savedToken;
    els.rememberToken.checked = true;
  }
  const params = new URLSearchParams(location.search);
  if (params.get('pipeline')) els.pipelineUrl.value = params.get('pipeline');
  if (params.get('gitlab')) els.gitlabBaseUrl.value = params.get('gitlab');

  els.loadBtn.addEventListener('click', loadPipeline);
  els.exportBtn.addEventListener('click', exportJson);
  els.zoomOutBtn.addEventListener('click', () => changeZoom(-0.25));
  els.zoomInBtn.addEventListener('click', () => changeZoom(0.25));
}

async function loadPipeline() {
  try {
    setStatus('Parsing pipeline URL...');
    const inputUrl = els.pipelineUrl.value.trim();
    if (!inputUrl) throw new Error('Pipeline URL is required.');

    const parsed = parsePipelineUrl(inputUrl);
    const baseUrl = (els.gitlabBaseUrl.value.trim() || parsed.baseUrl).replace(/\/$/, '');
    const token = els.token.value.trim();
    if (!token) throw new Error('Access token is required for private GitLab projects.');

    if (els.rememberToken.checked) localStorage.setItem('gitlabTimelineToken', token);
    else localStorage.removeItem('gitlabTimelineToken');

    setStatus(`Loading pipeline ${parsed.pipelineId}...`);

    const api = new GitLabApi(baseUrl, token);
    const project = await api.getProjectByPath(parsed.projectPath);
    const tree = await loadPipelineTree(api, project.id, parsed.pipelineId, null, 0);

    lastResult = {
      gitlabBaseUrl: baseUrl,
      rootProjectPath: parsed.projectPath,
      loadedAt: new Date().toISOString(),
      tree,
    };

    render(lastResult);
    setStatus('Done.');
  } catch (err) {
    console.error(err);
    setStatus(`Error: ${err.message}`);
  }
}

function parsePipelineUrl(value) {
  const url = new URL(value);
  const match = url.pathname.match(/^\/(.+?)\/-\/pipelines\/(\d+)/);
  if (!match) {
    throw new Error('Unsupported pipeline URL format. Expected /group/project/-/pipelines/123.');
  }
  return {
    baseUrl: `${url.protocol}//${url.host}`,
    projectPath: decodeURIComponent(match[1]),
    pipelineId: Number(match[2]),
  };
}

class GitLabApi {
  constructor(baseUrl, token) {
    this.baseUrl = baseUrl;
    this.token = token;
  }

  async getProjectByPath(projectPath) {
    return this.request(`/projects/${encodeURIComponent(projectPath)}`);
  }

  async getPipeline(projectId, pipelineId) {
    return this.request(`/projects/${projectId}/pipelines/${pipelineId}`);
  }

  async getJobs(projectId, pipelineId) {
    return this.requestAllPages(`/projects/${projectId}/pipelines/${pipelineId}/jobs?per_page=100&include_retried=true`);
  }

  async getBridges(projectId, pipelineId) {
    return this.requestAllPages(`/projects/${projectId}/pipelines/${pipelineId}/bridges?per_page=100`);
  }

  async request(path) {
    const res = await fetch(`${this.baseUrl}/api/v4${path}`, {
      headers: {
        'PRIVATE-TOKEN': this.token,
        'Accept': 'application/json',
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GitLab API ${res.status} ${res.statusText}: ${body.slice(0, 300)}`);
    }
    return res.json();
  }

  async requestAllPages(path) {
    let url = `${this.baseUrl}/api/v4${path}`;
    const out = [];
    while (url) {
      const res = await fetch(url, {
        headers: {
          'PRIVATE-TOKEN': this.token,
          'Accept': 'application/json',
        },
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`GitLab API ${res.status} ${res.statusText}: ${body.slice(0, 300)}`);
      }
      out.push(...await res.json());
      url = res.headers.get('x-next-page')
        ? `${this.baseUrl}/api/v4${path.split('?')[0]}?${mergePageParam(path, res.headers.get('x-next-page'))}`
        : null;
    }
    return out;
  }
}

function mergePageParam(path, page) {
  const query = path.includes('?') ? path.split('?')[1] : '';
  const params = new URLSearchParams(query);
  params.set('page', page);
  return params.toString();
}

async function loadPipelineTree(api, projectId, pipelineId, parent, depth) {
  const [pipeline, jobs, bridges] = await Promise.all([
    api.getPipeline(projectId, pipelineId),
    api.getJobs(projectId, pipelineId),
    api.getBridges(projectId, pipelineId),
  ]);

  setStatus(`Loaded pipeline ${pipelineId}: ${jobs.length} jobs, ${bridges.length} bridges. Reading children...`);

  const node = {
    projectId,
    pipelineId,
    parentPipelineId: parent?.pipelineId ?? null,
    depth,
    pipeline,
    jobs: normalizeJobs(jobs, 'job'),
    bridges: normalizeJobs(bridges, 'bridge'),
    children: [],
  };

  for (const bridge of bridges) {
    if (!bridge.downstream_pipeline) continue;
    const childProjectId = bridge.downstream_pipeline.project_id || projectId;
    const childPipelineId = bridge.downstream_pipeline.id;
    node.children.push(await loadPipelineTree(api, childProjectId, childPipelineId, node, depth + 1));
  }

  return node;
}

function normalizeJobs(items, type) {
  return items.map(item => ({
    id: item.id,
    type,
    name: item.name,
    stage: item.stage || 'bridge',
    status: item.status,
    createdAt: item.created_at,
    startedAt: item.started_at,
    finishedAt: item.finished_at,
    duration: item.duration,
    webUrl: item.web_url,
    downstreamPipeline: item.downstream_pipeline || null,
  }));
}

function render(result) {
  const flatPipelines = flattenPipelines(result.tree);
  const allItems = flatPipelines.flatMap(p => [...p.jobs, ...p.bridges]);
  const timedItems = allItems.filter(x => x.startedAt || x.createdAt);
  const minTime = Math.min(...timedItems.map(x => new Date(x.startedAt || x.createdAt).getTime()));
  const maxTime = Math.max(...timedItems.map(x => new Date(x.finishedAt || x.startedAt || x.createdAt).getTime()));

  renderSummary(flatPipelines, allItems, minTime, maxTime);
  renderTimeline(flatPipelines, minTime, maxTime);

  els.summaryPanel.classList.remove('hidden');
  els.timelinePanel.classList.remove('hidden');
}

function flattenPipelines(root) {
  return [root, ...root.children.flatMap(flattenPipelines)];
}

function renderSummary(pipelines, items, minTime, maxTime) {
  const counts = countBy(items, x => x.status || 'unknown');
  const duration = Math.round((maxTime - minTime) / 1000);
  els.summary.innerHTML = '';
  addSummaryCard('Pipelines', pipelines.length);
  addSummaryCard('Jobs + bridges', items.length);
  addSummaryCard('Total duration', formatDuration(duration));
  for (const [status, count] of Object.entries(counts)) addSummaryCard(status, count);
}

function addSummaryCard(label, value) {
  const div = document.createElement('div');
  div.className = 'summary-card';
  div.innerHTML = `<strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(label)}</span>`;
  els.summary.appendChild(div);
}

function renderTimeline(pipelines, minTime, maxTime) {
  els.timeline.innerHTML = '';
  const totalMs = Math.max(maxTime - minTime, 1);
  const width = Math.max(480, totalMs / 1000 * 6 * timelineZoom);

  els.timeline.appendChild(createTimeScale(minTime, maxTime, width));

  for (const pipeline of pipelines) {
    const heading = document.createElement('div');
    heading.className = 'pipeline-heading';
    heading.textContent = `${'› '.repeat(pipeline.depth)}Pipeline #${pipeline.pipelineId} · project ${pipeline.projectId}`;
    els.timeline.appendChild(heading);

    const items = [...pipeline.jobs, ...pipeline.bridges]
      .sort((a, b) => new Date(a.startedAt || a.createdAt) - new Date(b.startedAt || b.createdAt));

    for (const item of items) {
      els.timeline.appendChild(createJobRow(item, minTime, totalMs, width));
    }
  }
}

function changeZoom(delta) {
  if (!lastResult) return;
  timelineZoom = Math.min(3, Math.max(0.01, timelineZoom + delta));
  render(lastResult);
}

function createTimeScale(minTime, maxTime, width) {
  const scale = document.createElement('div');
  scale.className = 'time-scale';
  scale.style.width = `${width + 332}px`;

  const area = document.createElement('div');
  area.style.position = 'relative';
  area.style.marginLeft = '332px';
  area.style.width = `${width}px`;
  area.style.height = '30px';
  scale.appendChild(area);

  const ticks = 6;
  for (let i = 0; i <= ticks; i++) {
    const t = minTime + ((maxTime - minTime) * i / ticks);
    const tick = document.createElement('div');
    tick.className = 'tick';
    tick.style.left = `${i / ticks * 100}%`;
    tick.textContent = new Date(t).toLocaleTimeString();
    area.appendChild(tick);
  }
  return scale;
}

function createJobRow(item, minTime, totalMs, width) {
  const template = document.getElementById('jobTemplate');
  const row = template.content.firstElementChild.cloneNode(true);
  const title = row.querySelector('.job-title');
  const subtitle = row.querySelector('.job-subtitle');
  const bar = row.querySelector('.bar');
  const area = row.querySelector('.bar-area');

  area.style.width = `${width}px`;
  title.textContent = `${item.type === 'bridge' ? '↳ ' : ''}${item.name}`;
  subtitle.textContent = `${item.stage} · ${item.status} · ${formatDuration(item.duration || 0)}`;

  const start = new Date(item.startedAt || item.createdAt).getTime();
  const end = new Date(item.finishedAt || item.startedAt || item.createdAt).getTime();
  const left = Math.max(0, (start - minTime) / totalMs * width);
  const barWidth = Math.max(4, (Math.max(end - start, 1000)) / totalMs * width);

  bar.style.left = `${left}px`;
  bar.style.width = `${barWidth}px`;
  bar.classList.add(statusClass(item.status));
  bar.href = item.webUrl || '#';
  bar.title = `${item.name}\n${item.status}\n${item.startedAt || ''} → ${item.finishedAt || ''}`;
  return row;
}

function statusClass(status) {
  if (status === 'success') return 'status-success';
  if (status === 'failed' || status === 'canceled') return 'status-failed';
  if (status === 'running' || status === 'pending') return 'status-running';
  if (status === 'manual') return 'status-manual';
  if (status === 'skipped') return 'status-skipped';
  return 'status-default';
}

function countBy(items, fn) {
  return items.reduce((acc, item) => {
    const key = fn(item);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function formatDuration(seconds) {
  if (!seconds || seconds < 1) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h ? `${h}h` : '', m ? `${m}m` : '', `${s}s`].filter(Boolean).join(' ');
}

function setStatus(message) {
  els.status.textContent = message;
}

function exportJson() {
  if (!lastResult) return;
  const blob = new Blob([JSON.stringify(lastResult, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gitlab-pipeline-${lastResult.tree.pipelineId}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[c]));
}
