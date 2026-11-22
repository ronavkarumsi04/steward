WITH entries AS (
  SELECT a.id, a.company_id, e.ordinality AS position, e.value AS original,
    CASE WHEN e.value ~ '^mcp\.[^.]+\..+$'
      THEN 'mcp.' || regexp_replace(lower(split_part(e.value, '.', 2)), '[^a-z0-9_]', '_', 'g')
      ELSE NULL END AS namespace,
    substring(e.value FROM '^mcp\.[^.]+\.(.+)$') AS rest
  FROM agents a
  CROSS JOIN LATERAL jsonb_array_elements_text(a.tool_allowlist) WITH ORDINALITY AS e(value, ordinality)
), resolved AS (
  SELECT e.*, CASE
    WHEN namespace IS NULL OR namespace = 'mcp.' || split_part(original, '.', 2) THEN original
    WHEN (SELECT count(*) FROM mcp_servers s WHERE s.company_id = e.company_id
      AND 'mcp.' || regexp_replace(lower(s.slug), '[^a-z0-9_]', '_', 'g') = e.namespace) > 1 THEN NULL
    WHEN rest = '*' OR (right(rest, 2) = '.*' AND NOT starts_with(rest, namespace || '.')) THEN namespace || '.' || rest
    ELSE (
      SELECT CASE WHEN count(*) = 1 THEN min(pattern) ELSE NULL END
      FROM (
        SELECT DISTINCT p.pattern
        FROM (VALUES (e.namespace || '.' || e.rest), (CASE WHEN starts_with(e.rest, e.namespace || '.') THEN e.rest END)) AS p(pattern)
        WHERE p.pattern IS NOT NULL AND EXISTS (
          SELECT 1 FROM mcp_servers s JOIN mcp_tools t ON t.server_id = s.id AND t.company_id = s.company_id
          WHERE s.company_id = e.company_id AND s.slug = lower(split_part(e.original, '.', 2))
            AND (t.tool_name = p.pattern OR (right(p.pattern, 2) = '.*' AND starts_with(t.tool_name, left(p.pattern, length(p.pattern) - 1))))
        )
      ) candidates
    ) END AS entry
  FROM entries e
), deduped AS (
  SELECT id, entry, min(position) AS position FROM resolved WHERE entry IS NOT NULL GROUP BY id, entry
), rewritten AS (
  SELECT a.id, coalesce(jsonb_agg(d.entry ORDER BY d.position) FILTER (WHERE d.entry IS NOT NULL),
    CASE WHEN jsonb_array_length(a.tool_allowlist) > 0 THEN '["__steward_no_tools__"]'::jsonb ELSE '[]'::jsonb END) AS allowlist
  FROM agents a LEFT JOIN deduped d ON d.id = a.id GROUP BY a.id, a.tool_allowlist
)
UPDATE agents a SET tool_allowlist = r.allowlist
FROM rewritten r WHERE a.id = r.id AND a.tool_allowlist IS DISTINCT FROM r.allowlist;
