# Copa Rinha II — contas, presença e índice de replays

Implementação local na branch `feat/copa-rinha-national-dex-za`. Sem push,
deploy, alteração de infraestrutura ou acesso a objetos de produção nesta tarefa.

## Contas e identidades

`server/copa-accounts.ts` usa o R2 privado já existente. Mantém contas permanentes,
scrypt N=32768/r=8/p=3 com salt aleatório de 128 bits, sessões aleatórias de 256 bits
com validade absoluta de 30 dias e somente hashes de tokens/códigos no registro.
O registro `copa-accounts/v1/registry.json` usa ETag/If-Match ou If-None-Match para
não perder alterações concorrentes entre workers. Não existe fallback volátil.
Riquelme é a única reserva inicial. Reserva administrativa não prova titularidade:
a administração verifica o participante antes de emitir recuperação/primeira senha.

As quatro variáveis R2 existentes são usadas sem alterar seus valores. A única
configuração adicional para administração é `COPA_RINHA_ADMIN_KEY`, exclusivamente
no servidor: segredo aleatório de pelo menos 32 bytes, codificado em base64url
(43 caracteres). Não versionar, colocar no client, URL ou logs. Ausente/curto → 403.
A página `/copa-admin.html` pede essa chave a cada uso e não a persiste.

O administrador pode reservar/liberar reservas em lote, desativar/reativar contas
e emitir recuperação descartável de 24 horas. Contas registradas não são liberadas
por expiração de sessão ou remoção de reserva. Recuperação revoga sessões anteriores.
Limites atuais: 1000 contas, 4096 sessões e registro de até 2 MiB. scrypt permite duas
derivações simultâneas; login tem limites por nickname e por origem de rede. Não
se confia cegamente em X-Forwarded-For; a agregação por proxy precisa ser observada
no teste real do Render, principalmente com vários participantes atrás do mesmo IP.

O grant HTTPS de 30 segundos é descartável e vinculado ao challenge nativo daquela
conexão. No WebSocket só transita o marcador público `copa`, nunca senha/bearer.
A conta local continua nativamente NÃO registrada na Smogon. Não herda identidades
oficiais registradas/trusted/autoconfirmed nem as promove na mesma conexão. Todas
as abas de um User pertencem à mesma conta; outra conta exige sair primeiro.
Assertivas oficiais válidas seguem a verificação upstream. Os testes de assertivas
isolam o verificador; não equivalem a autenticação real no psim.us.

## Presença e limpeza

O roster usa o protocolo nativo `/cmd copapresence` e inclui os dois clients.
Conta uma identidade conectada uma vez, agrega visitantes e expõe apenas nome,
avatar, status e booleano em batalha (sem IDs de salas). Não consulta sessões
persistidas para decidir quem está online. O client atualiza a cada 15 segundos,
interrompe polling em abas ocultas e invalida a lista após desconexão/timeout.

Uma aba anônima é um Guest distinto: não se tenta identificar a pessoa por IP ou
fingerprinting. O cache nativo de usuários desconectados não é contado. O contador
antigo vinha do snapshot `/cmd rooms`, que podia permanecer desatualizado.
O raw WebSocket não tinha heartbeat; o monitor Copa usa ping/pong de transporte
(30 s, tolerância de 90 s), sem confundir inatividade humana com desconexão.
Uma perda silenciosa de rede pode demorar aproximadamente 150 s para completar
inclusive o fechamento de transporte. Fechamento normal limpa a última conexão
imediatamente. Manter sessão de 30 dias não mantém socket/usuário online.

## Central de replays e privacidade

GET `/copa-rinha/replays/?player=<userid>&cursor=<token>` lista até 20 metadados
públicos em ordem decrescente de data. Filtro é pelo nickname exato normalizado.
ListObjectsV2 usa os prefixos `replay-index/v1/all/` e `replay-index/v1/player/ID/`;
cada página lê no máximo 20 metadados canônicos em `replay-index/v1/records/`, não os logs completos. A visibilidade canônica bloqueia ponteiros antigos mesmo se a remoção de um índice falhar. A criação condicional impede reindexações de ressuscitarem um registro já ocultado. Cache de
15 s, limitado a 128 consultas por worker. Bucket continua privado e o CORS da API
permanece limitado ao domínio do client. Não há endpoint de enumeração de times.

Novos replays registram a visibilidade final da sala. Apenas uma sala conhecida,
pública, sem hideReplay/unlistReplay, é indexada. Qualquer estado desconhecido é
excluído. Privados e não listados não são descobertos na central. `/hidereplay` e
privacidade da sala após o término retiram o replay do índice; outros workers podem
reter metadados previamente públicos por até 15 s. A retirada é assíncrona, com
falhas registradas pelo diagnóstico seguro `IndexReplay`; confirmar o resultado no
QA real, inclusive falhas de armazenamento. Não há como revogar cópias já públicas.
O acesso direto por ID preserva o contrato anterior de link não listado/capacidade;
não se introduziu uma ACL nova nem se quebraram os links antigos.

Falhar a indexação não perde a batalha salva nem impede o anúncio de seu link.
`tools/copa-replay-reindex.js` permite reparar/importar APENAS registros que já
contenham `visibility: public`. Após build, executar primeiro `--dry-run` e revisar
os totais; `--write` escreve somente o índice e retira entradas explicitamente privadas/não listadas. A ferramenta faz uma varredura única,
fora do caminho HTTP. Ela NÃO foi executada contra R2 nesta tarefa. Objetos antigos
sem visibilidade explícita permanecem acessíveis por ID, mas nunca são publicados
por inferência, mesmo que tenham sido de uma sala aparentemente pública.

## Publicação futura e rollback

1. Revisar os commits locais dos dois repositórios. Publicar primeiro o client
   (`feat/copa-rinha-gimmick-ui`), depois o servidor, sem force push. Não executar
   esse passo até aprovação. Verificar antes se o push aciona auto-deploy do Render.
2. Antes de ativar contas, configurar a chave administrativa apenas no servidor,
   confirmar acesso privado R2 com conditional writes, leitura/listagem e remoção
   dos índices. Preservar variáveis existentes, dados e comandos de serviço.
   Garantir que `copa-accounts/` e `teams/` não estejam em lifecycle de expiração;
   o código não altera políticas de bucket. Não criar PostgreSQL/serviço pago.
3. Client: build completo com checkout do servidor correto, publicar
   `play.pokemonshowdown.com`. Servidor: manter build/start atuais. Nada foi
   configurado ou implantado no Render nesta tarefa.
4. Verificar Riquelme reservado, recuperação administrativa com titular validado,
   registro de dois nomes de QA e todos os casos de navegação/sessão/múltiplas abas.
   Reiniciar servidor e reabrir browser para provar persistência real. Após fechar
   a última aba, confirmar ausência no roster e sessão ainda válida no admin.
5. Completar batalha pública, privada e com /hidereplay. Conferir central, filtro,
   paginação, copiar/assistir, links antigos e exclusão dos privados/legados sem
   visibilidade. Verificar R2 privado no console. Não usar builds reais de jogadores
   como fixtures públicas. Testar Teambuilder/share individual e o psim.us oficial.
6. Rollback: voltar client para `26c020d0687cabde9274420a11cebf98761238ab` e servidor
   para `57c67d3616fff1429170661b0762abae977edb01`, mantendo objetos R2. Isso desativa
   a proteção de contas locais recém-criada no servidor antigo; restringir acesso
   durante rollback para não liberar nomes a novos visitantes inadvertidamente.
   Não apagar/migrar contas, sessões, times ou replays ao reverter código.

## Validação local

Build servidor, TypeScript e oxlint sem erros/avisos. Regressões de usuários/salas,
contas, presença, sockets, teams/replays, protocolo/formato Copa, Sleep Clause e
mecânicas: 223 testes passaram. R2/ETag/S3 e recuperação usam stores/transportes
isolados; há sockets WebSocket reais de loopback para heartbeat/limpeza.

O client executa suite completa (207 passam, 1 skip), TypeScript/lint e build full
sem atualizar o checkout preservado. Chromium cobre os quatro tamanhos 1440,
1000, 390, 320 px e as jornadas descritas no relatório do client. GIFs originais
Z-A são verificados por hash e decodificados no Chromium. Não foi validada nenhuma
operação com R2/Render/psim.us de produção. A rede deste ambiente bloqueia o Render
e o CDN oficial; fixtures de protocolo e bytes de imagens oficiais com hashes
substituem esses acessos nos testes. Não confundir essa validação com aprovação
operacional em produção.
