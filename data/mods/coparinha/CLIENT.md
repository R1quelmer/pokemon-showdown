# Revisão do pokemon-showdown-client para Copa Rinha

Revisão somente de leitura de `smogon/pokemon-showdown-client`, HEAD/master
`702e90d35d0c376c6a44ad7a60f867508c748ae4`, confirmado com `git ls-remote`.
Arquivos baixados por SHA, em vez de referenciar um `master` mutável.
Nenhum código de cliente foi alterado. Não houve teste visual em navegador.

## O protocolo já serve

`battle-choices.ts:28-57` já tipa Mega, Z, Max/G-Max e Tera como campos
independentes. `fixRequest`, linhas 686-703, normaliza `maxMoves` e `canZMove`
com dois `if` independentes: mantém os dois na mesma request, e move
`maxMoves.gigantamax` para `active.gigantamax`. Portanto não é necessário novo
campo de protocolo nem inferir elegibilidade pelo item ou pela geração.

O cliente deve sempre usar a request mais recente do servidor, que já aplica
os limites por jogador e o bloqueio permanente por Pokémon. Não deve criar uma
flag única "jogador já usou gimmick" nem rejeitar Mega Stone/Z-Crystal ao
oferecer D-Max/Tera.

## Cliente antigo

Arquivo `play.pokemonshowdown.com/src/oldclient/client-battle.js`:

1. `updateMoveControls`, linhas 567-584 e 735-758, já calcula e desenha as
   opções independentemente. Preservar isso. Entretanto o rótulo da opção Max
   (751-752) é sempre "Dynamax"; usar o `gigantamax` já extraído em 577/584
   para rotular "Gigantamax" quando aplicável.
2. `updateMoveControls`, 698-731, **só cria um** menu especial:
   `canZMove ? 'z' : 'max'` (699) e `canZMove ? canZMove : maxMoves.maxMoves`
   (705). Com Z e G-Max disponíveis, o menu Max não existe e clicar Dynamax
   chama seletores CSS inexistentes. Gerar três listas independentes: base,
   Z quando houver `canZMove`, e Max quando houver `maxMoves`. Exibir uma por
   vez segundo a escolha atual; se já estiver Dynamaxado, mostrar Max sem
   permitir outra ativação. Manter índices de movimentos, target, disabled,
   PP, tipos e tooltips correspondentes à lista correta. A escolha de PP em
   721 também deve depender de qual lista se está renderizando, e não da mera
   presença de `canZMove`.
3. Eventos em 54-59, `updateZMove` (532-540), `updateMaxMove` (522-530) e
   `uncheckMegaEvoX/Y` (516-521): trocar a exclusividade parcial Mega-X/Y por
   uma seleção comum para Mega/Z/Max/Tera (com opção "nenhuma"). Ao marcar
   uma, desmarcar as demais, preservar todos os botões disponíveis e mudar
   somente a lista de ataques ativa. Desmarcar restaura o menu base.
4. `chooseMove`, 1285-1299, concatena todas as flags dos checkboxes, gerando
   comando inválido se mais de um estiver marcado. Serializar exatamente a
   única mecânica escolhida e validar a invariável antes de enviar. Manter a
   escolha ao passar pela seleção de alvo (1300-1312).
5. `getPlayerChoicesHTML`, 1037-1039, sempre escreve "Dynamax, then";
   adaptar para "Gigantamax" quando a request identificar G-Max.

## Cliente moderno

Arquivo `play.pokemonshowdown.com/src/panel-battle.tsx`:

1. `renderMoveMenu`, 760-818, já renderiza Mega, Z, Max e Tera com condicionais
   independentes. Não é necessário reescrever isso para mostrar os quatro
   botões. G-Max já recebe o rótulo correto em 788.
2. `toggleBoostedMove`, 554-583, muda flags independentes; só X/Y se excluem.
   Adicionar seleção mutuamente exclusiva para Mega/Z/Max/Tera, limpando
   as outras flags antes de ativar uma. Pode usar enum local ou helper; manter
   os botões disponíveis visíveis, apenas um selecionado. Não consumir limite
   permanente em clique cancelável.
3. `renderMoveControls`, 820-893, **já tem** caminhos separados para Max e Z
   (`current.max` em 829 e `current.z` em 854), inclusive G-Max/disabled em
   833-849. Com flags exclusivas, as listas já alternam corretamente. Preservar
   os caminhos e adicionar regressões para a request Z+G-Max+Tera; não repetir a
   reconstrução necessária no cliente antigo.
4. `renderMoveMenu`, 770, não usa `alreadyTera` embora o builder a mantenha.
   Para suporte futuro a múltiplos ativos, aplicar `!choices.alreadyTera`,
   equivalente aos limites separados Mega/Z/Max. Isso é melhoria de escolha
   do mesmo turno em doubles, não um requisito novo para o protótipo singles.

Arquivo `play.pokemonshowdown.com/src/battle-choices.ts`:

1. `parseChoice`, 404-520, aceita múltiplas flags: Mega, Z, Max e Tera são
   simplesmente ativadas durante o parsing (442-468), inclusive combinações
   inválidas. Validar no fim do parsing que há no máximo uma mecânica por
   ação, contando também flags inferidas por nome de Z/Max move (492-513).
   Conferir sua disponibilidade na request atual; evitar aceitar entradas de
   chat/macro que contornem a UI.
2. `moveSpecial`, 604-611, concatena todas as flags ativas. Aplicar a mesma
   invariável no helper ou representar a escolha como campo único para que
   uma escolha construída programaticamente também não serialize múltiplas
   mecânicas.
3. `alreadyMega`, `alreadyZ`, `alreadyMax`, `alreadyTera` (151-154 e 278-281)
   são separados: preservá-los. Eles controlam escolhas na request, não são um
   contador compartilhado de todas as gimmicks. O servidor continua autoridade
   para os limites durante toda a batalha.
4. `currentMoveList`, 388-399, já escolhe Z/Max corretamente quando as flags são
   exclusivas. Não alterar a normalização em 686-703 para um `else if`.

## Verificação dinâmica isolada

Uma sondagem isolada transpila o arquivo upstream atual com esbuild e executa
somente o builder com um Dex mínimo simulado, sem mudar o cliente ou o servidor.
Resultado observado:

- `parseChoice('move 1 mega zmove dynamax terastallize')` aceita as quatro flags;
- `stringChoice` gera `move 1 max mega zmove terastallize`;
- `currentMoveList` retorna corretamente Z ou G-Max ao receber uma única flag.

Isso confirma a falha concreta do parser e que o menu moderno já contém o
suporte básico. Não é um teste da aplicação cliente completa ou do navegador.

## Cobertura exigida para a tarefa futura do cliente

- Requests de Venusaur com Mega/Max/Tera e Pikachu com Z/G-Max/Tera.
- Renderização simultânea de opções; alternância mutuamente exclusiva,
  incluindo desmarcar e cancelar.
- Z e G-Max exibem movimentos, alvos, PP, disabled e tooltips corretos.
- Serialização de uma única flag, rejeição de combinações via chat/macros.
- Request após uma ativação elimina as opções daquele Pokémon sem eliminar
  as outras mecânicas disponíveis para os companheiros.
- G-Max rotulado corretamente; Max Moves continuam disponíveis nos turnos
  restantes de Dynamax sem oferecer nova ativação.
- Retorno de alvo/cancelamento/reconexão não reintroduz seleção antiga.

## Links fixados no commit analisado

- Antigo: https://github.com/smogon/pokemon-showdown-client/blob/702e90d35d0c376c6a44ad7a60f867508c748ae4/play.pokemonshowdown.com/src/oldclient/client-battle.js#L698
- Moderno: https://github.com/smogon/pokemon-showdown-client/blob/702e90d35d0c376c6a44ad7a60f867508c748ae4/play.pokemonshowdown.com/src/panel-battle.tsx#L554
- Builder: https://github.com/smogon/pokemon-showdown-client/blob/702e90d35d0c376c6a44ad7a60f867508c748ae4/play.pokemonshowdown.com/src/battle-choices.ts#L404
