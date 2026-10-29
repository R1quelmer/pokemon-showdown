# Replays próprios — Etapa 1

Somente batalhas concluídas de `gen9coparinhanationaldexza` são salvas.
O hook captura o log nativo e metadados antes da limpeza da batalha, sem aguardar
R2 no caminho de encerramento. O anúncio só acontece após PutObject confirmado.
IDs de 192 bits são gerados com crypto.randomBytes; conhecer o link permite
ler o replay pela API, mesmo com bucket privado. Não há busca nem upload público.
Mensagens comuns de chat e HTML humano são removidas; linhas do protocolo de
batalha, incluindo Mega, Z, Tera e Dynamax/Gigantamax, são preservadas.

## Render

Mantenha a branch `feat/copa-rinha-national-dex-za` e o comando de build/start
existente (`npm ci` e `npm run build` devem instalar/compilar a nova dependência).
As quatro variáveis já configuradas devem estar disponíveis no processo de jogo
e nos workers HTTP: `R2_BUCKET`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`. O endpoint deve usar HTTPS e a API S3 do R2; região `auto`.
A identidade precisa de leitura e escrita de objetos no bucket privado
`copa-rinha-replays`. Não habilite acesso público nem CORS no bucket: o servidor
faz o acesso autenticado. A API permite leitura CORS somente para
`https://copa-rinha-client.onrender.com` e responde 400/404/405/503 conforme o caso.
Nenhuma variável adicional é obrigatória. Faça deploy do cliente também,
conforme as instruções em COPA-RINHA.md daquele repositório.

## Validação

- `npm run build`
- `npm run tsc -- --noEmit`
- `npm run lint`
- `npx mocha --no-config test/server/copa-replays.js`: seis casos, armazenamento
  mockado; metadados, IDs, filtro, quatro mecânicas, formatos, falhas e API/CORS.

Não foram fornecidas credenciais R2 neste ambiente: nenhum acesso real ao bucket
foi testado. Para QA real, termine uma partida do formato alvo no site, aguarde
o anúncio e abra o link em outra sessão. Confira o objeto no painel privado R2,
a resposta JSON e a reprodução. Repita com forfeit/empate e outro formato.
