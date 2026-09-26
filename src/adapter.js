// The only Instagram-specific parsing in the project. Instagram changes these names
// often; if the scraper stops finding posts, re-run `pnpm probe` and update here.
//
// As of Sept 2026 the profile grid loads posts through POST /graphql/query:
//   first page:  PolarisProfilePostsQuery
//   next pages:  PolarisProfilePostsTabContentQuery_connection  (variables.after = cursor)
// Both return data.xdt_api__v1__feed__user_timeline_graphql_connection { edges, page_info }.

export const PAGING_QUERY = 'PolarisProfilePostsTabContentQuery_connection';
const TIMELINE_QUERIES = new Set(['PolarisProfilePostsQuery', PAGING_QUERY]);

// Headers the page's own fetch() may set; the browser adds cookies and the rest.
const FORWARDED_HEADERS = /^(x-|content-type$)/;

export function isTimelineRequest(request) {
  return TIMELINE_QUERIES.has(friendlyName(request));
}

export function isPagingRequest(request) {
  return friendlyName(request) === PAGING_QUERY;
}

function friendlyName(request) {
  if (request.method() !== 'POST' || !request.url().includes('/graphql/query')) return null;
  return request.headers()['x-fb-friendly-name'] ?? null;
}

export function parseJson(text) {
  return JSON.parse(text.replace(/^for \(;;\);/, ''));
}

// Returns { posts, endCursor, hasNextPage }, or null if the body isn't a timeline page
// (e.g. an error or rate-limit message sent with a 200 status).
export function parseTimeline(json, account) {
  const connection = json?.data?.xdt_api__v1__feed__user_timeline_graphql_connection;
  if (!connection?.edges) return null;
  return {
    posts: connection.edges.map((edge) => toRawPost(edge.node, account)),
    endCursor: connection.page_info?.end_cursor ?? null,
    hasNextPage: Boolean(connection.page_info?.has_next_page),
  };
}

function toRawPost(node, account) {
  const owner = node.user?.username ?? null;
  return {
    shortcode: node.code,
    caption: node.caption?.text ?? null,
    taken_at: node.taken_at ? new Date(node.taken_at * 1000).toISOString() : null,
    media_type: node.media_type,
    product_type: node.product_type ?? null,
    owner,
    coauthors: (node.coauthor_producers ?? []).map((u) => u.username),
    pinned: (node.timeline_pinned_user_ids ?? []).length > 0,
    other_account: owner !== account,
    captured_at: new Date().toISOString(),
  };
}

// Snapshot of the grid's own paging request, so we can replay it with any cursor.
export async function captureTemplate(request) {
  const headers = Object.fromEntries(
    Object.entries(await request.allHeaders()).filter(([name]) => FORWARDED_HEADERS.test(name)),
  );
  return { url: request.url(), headers, postData: request.postData() };
}

export function buildPagingBody(template, cursor) {
  const params = new URLSearchParams(template.postData);
  const variables = JSON.parse(params.get('variables'));
  variables.after = cursor;
  params.set('variables', JSON.stringify(variables));
  return params.toString();
}

export function parseMediaCount(text) {
  const match = text.match(/"media_count":(\d+)/);
  return match ? Number(match[1]) : null;
}
