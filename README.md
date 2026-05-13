# GitLab CI Timeline Visualizer

GitLab CI Timeline Visualizer is a small static web app for inspecting large GitLab pipelines on a time axis. It loads a pipeline directly from the GitLab API, renders jobs and bridge jobs as a horizontal timeline, and follows downstream pipelines recursively so you can see the full execution flow in one view.

It is designed for cases where the standard GitLab pipeline page is not enough, especially when a pipeline spans parent/child pipelines or triggers pipelines in other projects. The app runs entirely in the browser, can be hosted as a simple GitLab Pages site, and does not require a backend.

## Features

- Paste a GitLab pipeline URL and visualize jobs as a timeline
- Reads normal jobs from `/jobs`
- Reads trigger/bridge jobs from `/bridges`
- Recursively follows `downstream_pipeline`
- Supports dynamic child pipelines and multi-project downstream pipelines
- Runs as a static GitLab Pages site
- No backend required

## Quick start

1. Create a new GitLab project, for example `ci-tools/gitlab-ci-timeline-visualizer`.
2. Commit this repository.
3. Enable GitLab Pages if needed.
4. Open the Pages URL.
5. Paste:

```text
https://gitlab.example.com/group/project/-/pipelines/123456
```

6. Enter a GitLab token with API access.

## Token

Use a Personal Access Token with `read_api` scope.

The token is only stored in browser memory unless you tick **Remember token locally**.

## Supported pipeline URLs

```text
https://gitlab.example.com/group/project/-/pipelines/123456
https://gitlab.example.com/group/subgroup/project/-/pipelines/123456
```

You can also override the GitLab base URL manually in the UI.

## Notes

For private internal GitLab instances, CORS may block browser API calls depending on server settings. If that happens, use one of these approaches:

- host this app on the same GitLab instance using GitLab Pages
- configure GitLab/CORS appropriately
- add a small internal proxy backend
- generate JSON reports from CI instead of calling the API from browser

## API endpoints used

```text
GET /api/v4/projects/:id/pipelines/:pipeline_id/jobs?per_page=100
GET /api/v4/projects/:id/pipelines/:pipeline_id/bridges?per_page=100
GET /api/v4/projects/:id
```
