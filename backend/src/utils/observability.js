const requests = new Map();
const rateLimits = new Map();
const latencyBuckets = [50, 100, 250, 500, 1000, 2500, 5000];

function metricKey(method, route, status) {
  return JSON.stringify([method, route, status]);
}

export function recordHttpRequest({ method, route, status, durationMs }) {
  const key = metricKey(method, route, status);
  const row = requests.get(key) || { method, route, status, count: 0, durationMs: 0, buckets: Array(latencyBuckets.length + 1).fill(0) };
  row.count += 1;
  row.durationMs += durationMs;
  const bucket = latencyBuckets.findIndex((limit) => durationMs <= limit);
  row.buckets[bucket < 0 ? latencyBuckets.length : bucket] += 1;
  requests.set(key, row);
}

export function recordRateLimitEvent(route) {
  rateLimits.set(route, (rateLimits.get(route) || 0) + 1);
}

export function renderMetrics() {
  const lines = [
    '# HELP process_uptime_seconds Process uptime in seconds.',
    '# TYPE process_uptime_seconds gauge',
    `process_uptime_seconds ${process.uptime()}`,
    '# HELP process_resident_memory_bytes Resident set size in bytes.',
    '# TYPE process_resident_memory_bytes gauge',
    `process_resident_memory_bytes ${process.memoryUsage().rss}`,
    '# HELP http_requests_total Completed HTTP requests.',
    '# TYPE http_requests_total counter',
    '# HELP http_request_duration_milliseconds Request duration histogram.',
    '# TYPE http_request_duration_milliseconds histogram'
  ];
  for (const row of requests.values()) {
    const labels = `method="${row.method}",route="${row.route}",status="${row.status}"`;
    lines.push(`http_requests_total{${labels}} ${row.count}`);
    let cumulative = 0;
    latencyBuckets.forEach((limit, index) => {
      cumulative += row.buckets[index];
      lines.push(`http_request_duration_milliseconds_bucket{${labels},le="${limit}"} ${cumulative}`);
    });
    cumulative += row.buckets[latencyBuckets.length];
    lines.push(`http_request_duration_milliseconds_bucket{${labels},le="+Inf"} ${cumulative}`);
    lines.push(`http_request_duration_milliseconds_sum{${labels}} ${row.durationMs}`);
    lines.push(`http_request_duration_milliseconds_count{${labels}} ${row.count}`);
  }
  lines.push('# HELP http_rate_limit_events_total Requests rejected by configured limiters.', '# TYPE http_rate_limit_events_total counter');
  for (const [route, count] of rateLimits) lines.push(`http_rate_limit_events_total{route="${route}"} ${count}`);
  return `${lines.join('\n')}\n`;
}
