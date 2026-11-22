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
  SELECT id, jsonb_agg(entry ORDER BY position) AS allowlist FROM deduped GROUP BY id
)
UPDATE agents a SET tool_allowlist = r.allowlist
FROM rewritten r WHERE a.id = r.id AND a.tool_allowlist IS DISTINCT FROM r.allowlist;
