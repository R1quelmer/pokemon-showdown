# Compartilhamento de times da Copa Rinha no R2

## O erro e a implementação nativa

`server/chat-plugins/teams.ts` bloqueia o banco de times em `validateAccess()` quando
`Config.usepostgres` ou `Config.usepostgresteams` não estão habilitados. O plugin
nativo abre a tabela PostgreSQL `teams` em `start()` e usa
`databases/schemas/teams.sql`. Além da configuração do banco, o caminho upstream
normal exige usuário autoconfirmado e o nível configurado em `usepostgresteams`.
Isso não corresponde ao modelo de nicknames locais da interface Copa Rinha.

No modo já existente `Config.copaRinhaSingleFormat`, o plugin agora usa a camada
`server/copa-teams.ts` para salvar objetos imutáveis no mesmo bucket R2 privado dos
replays. O caminho PostgreSQL permanece nativo fora desse modo. O plugin não abre
conexão PostgreSQL no modo Copa. Não há SQLite, arquivo local ou memória como
armazenamento alternativo em produção.

## Infraestrutura e variáveis

São reutilizadas exatamente as quatro variáveis da implementação de replays:

- `R2_BUCKET`
- `R2_ENDPOINT`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

Não são necessárias novas variáveis ou serviço pago. O SDK usa região `auto`,
endpoint S3 existente, duas tentativas e timeouts de conexão/requisição. Os valores
das variáveis, requests, assinaturas e cabeçalhos nunca são registrados. Os erros
expõem somente identificadores seguros e status HTTP pela filtragem existente de
`copa-replays.ts`.

Objetos novos: `teams/<id>.json`. Objetos antigos: `replays/<id>.json`, intactos.
Cada ID usa 24 bytes aleatórios (192 bits), codificados em base64url (32 caracteres).
O PUT envia `IfNoneMatch: *`, de modo que um ID existente não pode ser substituído.
O serviço não define expiração nem executa exclusão automática. Regras de lifecycle
externas do bucket precisam deixar `teams/` sem expiração; o código não altera
políticas do bucket. Não tornar o bucket público.

Os registros contêm somente versão, ID, data, formato, nome do time, packed team e
texto de importação. Não contêm IP, ownerid, senha, cookie, token ou credenciais.
O ID não é autenticação de conta: é uma capacidade de leitura não listada. Qualquer
pessoa com o link pode ler e importar o time. Não há busca/listagem pública.

## API e protocolo

- Leitura: `GET /copa-rinha/teams/<id>` no servidor da Copa.
- Link: `https://copa-rinha-client.onrender.com/team.html?id=<id>`.
- Dados: `{schemaVersion:1,id,createdAt,format,name,packedTeam,importText}`.
- Erros: 400 ID inválido, 404 inexistente, 405 método inválido, 429 limite de leitura,
  503 armazenamento indisponível. CORS permite somente a origem do client Copa;
  não há POST HTTP ou endpoint anônimo de upload.
- Upload: comando nativo `/teams save nome,formato,privacidade,time`, por conexão
  já nomeada ao servidor. O campo de privacidade nativo é aceito, mas a publicação
  Copa é sempre por link não listado, sem senha ou associação autenticada ao nick.
- Resposta Copa: `|queryresponse|copateamupload|` com `teamid` opaco,
  `teamName`, `privacy:null`, `url`, `visibility:'unlisted'`, `immutable:true` e
  `requestTeam`. O último apenas ecoa o input para correlacionar a resposta e não
  é persistido. Falhas enviam o mesmo evento com `error` seguro e `requestTeam`.
  O client próprio trata esse evento. O evento upstream `teamupload` permanece
  inalterado fora do modo Copa e **não é enviado para snapshots R2**: o client
  oficial espera IDs numéricos de conta, incompatíveis com nossos IDs opacos.
- O popup retorna o link correto e explica que todos com o link podem ler.
- `/teams upload` mantém o formulário HTML nativo, com formato Copa e explicação
  de compartilhamento não listado. `/teams view ID` e `view-team-ID` mostram o
  texto exportável e link; IDs com `-` são reconstruídos integralmente.

Não se permite editar, apagar ou trocar a privacidade somente com o mesmo nickname:
no modelo local, isso não prova autoria. O link publicado é imutável; editar um time
no Teambuilder gera uma nova cópia com novo ID. Para remoção administrativa de dados
publicados acidentalmente, um operador do bucket pode remover o objeto por seu ID,
sem excluir outros dados. Não foi criado endpoint público de administração.

## Compatibilidade com o client oficial

O endereço psim.us, conexão, autenticação e batalha não mudam. O client oficial
pode usar `/teams upload` para abrir o formulário nativo do servidor, publicar o
time e receber o popup com o link correto. Pode visualizar `view-team-ID` no
próprio servidor e copiar/importar o texto exportado. Não precisa de código novo.

**Limite da integração com o Teambuilder oficial:** o botão inline de upload do
client oficial usa IDs numéricos, recursos de conta e URLs `https://psim.us/t/…`.
Nossos objetos R2 não pertencem a esse serviço. O servidor envia `copateamupload`,
um evento adicional ignorado pelo client oficial, e o popup com o link Copa.
Nunca injeta o ID opaco no `teamupload` upstream, pois isso corromperia a associação
numérica guardada no modelo local do client oficial. O botão inline pode manter
seu indicador de upload até recarregar a página; não há confirmação/tracking de
conta no editor oficial. O fluxo suportado para esse client é o formulário
`/teams upload` e o link/página nativa retornados pelo servidor. Editar/apagar
snapshots R2 usando os controles de conta oficiais não é suportado.

Não alteramos o client oficial, psim.us, autenticação ou protocolo de batalha;
não criamos registro no serviço global nem enviamos dados a seu armazenamento.
O client próprio usa `copateamupload` para exibir o link sem atribuir `teamid`
numérico ou propriedade autenticada a um nickname.

## Validação, limites e privacidade

A camada utiliza `Teams.import`, `Teams.pack` e `Teams.export` nativos e aceita o
formato Copa e seus aliases, armazenando o ID canônico. A validação de storage
verifica espécies, movimentos e campos reconhecidos pelo Dex; não substitui a
validação de legalidade da batalha (times em construção continuam compartilháveis).
São aceitos até 300 sets, como no plugin nativo, e payload de até 64 KiB UTF-8;
nome de até 100 caracteres; até 24 movimentos por set, como no upstream.

Uploads exigem conexão com nickname confirmado, sem bloqueio/semibloqueio. Não
exigem autenticação oficial nem tratam nickname como prova de conta. Continuam
sujeitos ao limitador nativo de preparação e ao limite de 10 uploads/hora por IP e
nickname. O limite é volátil, com estrutura limitada a 10.000 chaves e limpeza de
entradas vencidas. Ele não tenta criar identidade persistente e não grava IP no R2.
Leitura limitada a 600/minuto por endereço da conexão, com orçamento compartilhado
entre a API HTTP e a página nativa `view-team-ID`, para não permitir bypass pelo
WebSocket. Atrás de proxy
Render, esse endereço pode agrupar usuários, devendo ser observado no teste real.

O endpoint devolve somente campos permitidos, reconstrói a exportação nativa e
não devolve metadados extras vindos do armazenamento. IDs não são nomes arbitrários
de objetos; traversal e IDs codificados inválidos são rejeitados. A página usa
referrer policy e a API `Referrer-Policy: no-referrer` para evitar repassar o link.

## PostgreSQL existente e publicação futura

Nenhuma credencial ou configuração privada do Render foi acessada nesta tarefa.
No checkout auditado, o uso funcional de `Config.usepostgres/usepostgresteams` está
no plugin nativo de teams; também há uma condição no comando administrativo de
update/restart. Não é necessário PostgreSQL para os novos times da Copa no R2,
mas isso não prova que um banco de produção esteja vazio ou sem outras aplicações.
Não apagamos o banco, migramos dados antigos, removemos variáveis ou alteramos
recursos de produção. Antes de abandonar um PostgreSQL existente, exportar os
registros nativos e confirmar o uso real em produção; links antigos não são
migrados automaticamente para IDs R2.

Publicação futura, somente após autorização:

1. Revisar os commits e manter as branches de cada serviço conforme o relatório.
2. Confirmar o bucket privado, credencial com leitura/escrita para `teams/` e
   `replays/`, e ausência de lifecycle de expiração para `teams/`.
3. Publicar client e servidor com os comandos/builds atuais, sem novo serviço PG.
4. Compartilhar um time de teste, abrir o link, copiar/importar e recarregar.
5. Reiniciar o servidor e reabrir o mesmo link para comprovar persistência real.
6. Conferir o popup pelo client oficial, a navegação `view-team-ID` e o replay de
   uma batalha; confirmar que objetos `replays/` antigos continuam acessíveis.
7. Não remover PostgreSQL/dados antigos durante esse teste.

Rollback: reverter os commits de times e retornar aos builds anteriores, mantendo
os objetos R2. Nenhum rollback exige apagar os dados de times/replays.

## Testes

`test/server/copa-teams.js` usa storage externo simulado e mocks de transporte SDK,
sem rede ou credenciais reais. Cobre roundtrip completo, aliases, limites, falhas,
IDs únicos/imutabilidade, instância reiniciada, API/CORS, throttle, diagnostics
seguros, caminho nativo de upload, permissão de nickname local e resposta de
protocolo. Resultados executados são apresentados no relatório da tarefa.
R2 de produção não foi testado sem acesso autorizado; configuração real do bucket,
lifecycle, prefixos da credencial, link persistente após deploy e client oficial
real continuam sujeitos ao teste de publicação acima.
