-- Função TEMPORÁRIA de exportação (migração do Meu Funil para a stack própria).
-- SÓ LEITURA. Só responde a quem manda o token cujo SHA-256 está abaixo.
-- Apagar depois da virada: DROP FUNCTION public.export_meufunil(text, text, text, text, integer, integer);
CREATE OR REPLACE FUNCTION public.export_meufunil(
  p_token text,
  p_action text,
  p_schema text DEFAULT NULL,
  p_table text DEFAULT NULL,
  p_limit integer DEFAULT 500,
  p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_counts jsonb := '{}'::jsonb;
  v_rows jsonb;
  v_n bigint;
  t text;
BEGIN
  IF p_token IS NULL OR encode(sha256(convert_to(p_token, 'UTF8')), 'hex') <> '__TOKEN_SHA256__' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_action = 'manifest' THEN
    FOR t IN SELECT table_name FROM information_schema.tables
             WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1 LOOP
      EXECUTE format('SELECT count(*) FROM public.%I', t) INTO v_n;
      v_counts := v_counts || jsonb_build_object('public.' || t, v_n);
    END LOOP;
    SELECT count(*) INTO v_n FROM auth.users;
    v_counts := v_counts || jsonb_build_object('auth.users', v_n);
    SELECT count(*) INTO v_n FROM auth.identities;
    v_counts := v_counts || jsonb_build_object('auth.identities', v_n);
    RETURN jsonb_build_object(
      'counts', v_counts,
      'buckets', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'public', public) ORDER BY id), '[]'::jsonb) FROM storage.buckets),
      'objects', (SELECT coalesce(jsonb_agg(jsonb_build_object('bucket_id', bucket_id, 'name', name, 'size', (metadata->>'size')::bigint) ORDER BY bucket_id, name), '[]'::jsonb) FROM storage.objects)
    );
  END IF;

  IF p_action = 'table' THEN
    IF NOT (
      (p_schema = 'public' AND EXISTS (SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name = p_table))
      OR (p_schema = 'auth' AND p_table IN ('users', 'identities'))
    ) THEN
      RAISE EXCEPTION 'tabela não permitida: %.%', p_schema, p_table;
    END IF;
    EXECUTE format(
      'SELECT coalesce(jsonb_agg(r), ''[]''::jsonb) FROM (SELECT to_jsonb(x) AS r FROM %I.%I x ORDER BY x::text LIMIT %s OFFSET %s) s',
      p_schema, p_table, least(greatest(p_limit, 1), 2000), greatest(p_offset, 0)
    ) INTO v_rows;
    RETURN jsonb_build_object('rows', v_rows);
  END IF;

  RAISE EXCEPTION 'ação inválida (manifest | table)';
END;
$$;

REVOKE ALL ON FUNCTION public.export_meufunil(text, text, text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.export_meufunil(text, text, text, text, integer, integer) TO anon, authenticated;
