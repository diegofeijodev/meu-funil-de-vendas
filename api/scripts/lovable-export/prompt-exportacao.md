Vamos preparar a exportação dos dados do sistema, em duas partes. Não mexa em telas, tabelas, dados nem políticas existentes.

PARTE 1 — Migration do banco
Crie uma migration com EXATAMENTE o SQL abaixo, sem alterar nada, e aplique. Ela cria uma função temporária e só de leitura (STABLE), protegida por token: sem o token certo ela só devolve erro. Vamos apagá-la depois da migração do sistema.

__SQL__

PARTE 2 — Endereço temporário só para ARQUIVOS
Crie no app um endereço de servidor temporário:
  GET /api/export-file?bucket=<bucket>&name=<caminho do arquivo>
Regras:
- Exige o header "x-export-token". Calcule o SHA-256 (hex) do valor recebido; se for diferente de
  __TOKEN_SHA256__, responda 403 e nada mais.
- Só aceite os buckets "creative-assets" e "ig-media"; outro bucket → 403.
- Com token certo: baixe o arquivo do Storage (bucket e caminho recebidos) no servidor, com a service role
  (src/integrations/supabase/client.server.ts), e devolva os bytes crus com status 200 e content-type application/octet-stream. Se não existir, 404.
- Não liste arquivos, não aceite outros métodos, não exponha a service role, não registre o token em log.
- Publique o app depois de criar o endereço.
