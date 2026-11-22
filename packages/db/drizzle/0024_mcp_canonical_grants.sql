WITH RECURSIVE entries AS (
  SELECT a.id, e.ordinality AS position, e.value AS original,
    CASE WHEN e.value ~ '^mcp\.[^.]+\..+$'
      THEN 'mcp.' || regexp_replace(lower(split_part(e.value, '.', 2)), '[^a-z0-9_]', '_', 'g')
      ELSE NULL END AS namespace,
    CASE WHEN e.value ~ '^mcp\.[^.]+\..+$'
      THEN substring(e.value FROM '^mcp\.[^.]+\.(.+)$')
      ELSE e.value END AS rest
  FROM agents a
  CROSS JOIN LATERAL jsonb_array_elements_text(a.tool_allowlist) WITH ORDINALITY AS e(value, ordinality)
  WHERE NOT (e.value ~ '^mcp\.[^.]+\..+$'
    AND split_part(e.value, '.', 2) <> regexp_replace(lower(split_part(e.value, '.', 2)), '[^a-z0-9_]', '_', 'g')
    AND (SELECT count(*) FROM mcp_servers s WHERE s.company_id = a.company_id
      AND regexp_replace(lower(s.slug), '[^a-z0-9_]', '_', 'g') = regexp_replace(lower(split_part(e.value, '.', 2)), '[^a-z0-9_]', '_', 'g')) > 1)
), collapsed AS (
  SELECT id, position, original, namespace, rest FROM entries
  UNION ALL
  SELECT id, position, original, namespace, substring(rest FROM length(namespace) + 2)
  FROM collapsed
  WHERE namespace IS NOT NULL AND namespace <> 'mcp.' || split_part(original, '.', 2)
    AND starts_with(rest, namespace || '.')
), canonical AS (
  SELECT id, position, CASE WHEN namespace IS NULL THEN original ELSE namespace || '.' || rest END AS entry
  FROM collapsed
  WHERE namespace IS NULL OR namespace = 'mcp.' || split_part(original, '.', 2)
    OR NOT starts_with(rest, namespace || '.')
), deduped AS (
  SELECT id, entry, min(position) AS position FROM canonical GROUP BY id, entry
), rewritten AS (
  SELECT a.id, coalesce(jsonb_agg(d.entry ORDER BY d.position) FILTER (WHERE d.entry IS NOT NULL), '[]'::jsonb) AS allowlist
  FROM agents a LEFT JOIN deduped d ON d.id = a.id GROUP BY a.id
)
UPDATE agents a SET tool_allowlist = r.allowlist
FROM rewritten r WHERE a.id = r.id AND a.tool_allowlist IS DISTINCT FROM r.allowlist;
