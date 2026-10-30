# [Copa Rinha] National Dex ZA

Formato singles de National Dex sem banimentos por tier. As **49 formas Mega de
Legends: Z-A implementadas no upstream** estão disponíveis, incluindo as
variantes Mega Z e DLC. Veja [ZA.md](./ZA.md) para a lista completa, pedras,
stats, tipos, abilities e a comparação fixada no upstream `ccfaa20f32af363569cd21a9d501b2bc1ded26b1`.

## Arquitetura e isolamento

- `config/custom-formats.ts` registra `[Gen 9] [Copa Rinha] National Dex ZA`,
  ID canônico `gen9coparinhanationaldexza`. O prefixo identifica a geração
  corretamente no Teambuilder; o mod continua sendo `coparinha`. O cliente
  migra os IDs antigos `coparinhanationaldexza` e `gen6coparinhanationaldexza`.
  Nenhum formato de `config/formats.ts` foi alterado. A exceção em `.gitignore`
  permite versionar esse arquivo de configuração customizada.
- `scripts.ts` herda os dados e as mecânicas de `gen9`. Os métodos locais de
  `BattleActions`, `Pokemon` e `Side` são instalados pelos pontos de extensão
  que o simulador já oferece, sem modificar os protótipos originais.
- `rulesets.ts` inicializa a disponibilidade de Dynamax e libera as formas/pedras de Z-A de forma específica, sem liberar Future globalmente.
- `conditions.ts` estende somente o início da condição Dynamax, reutilizando
  duração, HP, efeitos, encerramento e Gigantamax originais.
- `test/sim/othermetas/coparinha.js` testa o formato real, suas requests e ações;
  `coparinha-za.js` cobre as Megas de Z-A e seus dados upstream.
- `config/hosts.csv` identifica toda a faixa de loopback `127.0.0.0/8` como
  `localhost`, estendendo a entrada que cobria apenas `127.0.0.1`. Isso evita
  consultas PTR externas para os IPs de loopback dos testes de punições. Não
  altera mecânicas ou formatos, mas é uma alteração versionada de configuração.

No núcleo, Mega e Tera são controlados por `sim/battle-actions.ts`; Z-Moves
também passam por `getZMove`, `canZMove` e `runMove` nesse arquivo. A fila em
`sim/battle.ts` aplica Dynamax, cuja duração/HP são de `data/conditions.ts`.
`sim/pokemon.ts#getMoveRequestData` monta as opções e
`sim/side.ts#choose`/`chooseMove` validam o comando recebido.

As barreiras originais são diferentes: `Side` inicializa Dynamax como já usado
fora de Gen 8, `canDynamaxNow` verifica a geração, e `getDynamaxRequest` exclui
portadores de Mega Stone/Z-Crystal. Tera exclui esses itens em
`canTerastallize`. O mod substitui somente essas decisões, mantendo geração 9
para os demais cálculos. Não simula Gen 8 para habilitar Dynamax.

O validador verifica elegibilidade G-Max na forma Mega prospectiva ao avaliar
uma Mega Stone. O `init` copia a elegibilidade da espécie base para os dados
locais das Megas correspondentes. Isso só permite validar a escolha
dinâmica do set: uma Mega já ativada continua impedida de usar Dynamax.

## Regras e estado

O formato usa `Standard AG`, `NatDex Mod` e `Copa Rinha Mechanics` diretamente,
sem herdar OU, UU ou Ubers. Mantém Obtainable, Team Preview, HP Percentage,
Cancel Mod e Endless Battle Clause. Não inclui Species Clause nesta versão,
nem Terastal Clause ou Dynamax Clause. A validação de existência, movimentos,
habilidades e itens continua ativa; ausência de tiers não significa Hackmons.

Cada jogador mantém quatro disponibilidades independentes já implementadas:

| Mecânica | Limite por jogador | Registro por Pokémon |
| --- | --- | --- |
| Mega Evolution | `runMegaEvo` desabilita `canMegaEvo` dos aliados | `mega` |
| Z-Move | `side.zMoveUsed` | `zmove` |
| Dynamax / G-Max | `side.dynamaxUsed` | `dynamax` |
| Tera | `terastallize` limpa `canTerastallize` dos aliados | `tera` |

`pokemon.m.copaRinhaMechanic` registra a ativação, não o item nem uma seleção
ainda cancelável. Esse estado não é um volatile: persiste após trocas e após o
fim dos três turnos de Dynamax. Ao ativar, limpa Mega/Ultra/Tera daquele
Pokémon; a geração de requests Dynamax e Z e a validação Z consultam o mesmo
registro. Não consome as disponibilidades das outras mecânicas do jogador.
Z-Move impedido antes de sua ativação, por exemplo por sono, não é consumido.

As limitações de espécie originais (como `cannotDynamax`) permanecem.
Primal Reversion e Ultra Burst não constituem um quinto recurso novo deste
formato: continuam usando os caminhos herdados. Ultra Burst passa pelo wrapper
de Mega e trava o Pokémon individual; seu limite de equipe continua sendo o
limite separado herdado de Ultra Burst. Interações adicionais de Ultra Burst,
Primal Reversion, Transform e formatos doubles/multi não fazem parte da
cobertura inicial do protótipo singles.

Uma sondagem adicional encontrou um defeito herdado na restauração de estado:
Mew com `['transform', 'splash']` usa Transform em Blissey com `['splash']`;
depois `Battle.fromJSON(JSON.stringify(battle.toJSON()))` lança `TypeError` em
`sim/state.ts:239`, pois há menos slots transformados que slots base. O mesmo
erro foi reproduzido em `gen9nationaldexag` e em `gen9coparinhanationaldexza`.
Não é uma falha dos limites de gimmicks e não foi corrigido globalmente nesta
tarefa, para manter o isolamento do mod. A restauração após cada uma das quatro
gimmicks, sem esse caso de Transform, preservou o marcador nas sondagens.

## Protocolo e cliente

O servidor usa o protocolo existente, sem inventar novos campos:
`canMegaEvo`, `canZMove`, `canDynamax`, `maxMoves` e `canTerastallize` podem
coexistir na mesma request. `maxMoves.gigantamax` identifica a opção G-Max.
O parser original rejeita duas flags na mesma ação, por exemplo
`move 1 mega dynamax`, como `Conflicting arguments`.

Veja [CLIENT.md](./CLIENT.md) para a análise por função/linha do upstream
`smogon/pokemon-showdown-client`, fixada no commit
`702e90d35d0c376c6a44ad7a60f867508c748ae4`. O cliente antigo precisa gerar os
menus Z e Max separadamente e rotular G-Max corretamente. O moderno já possui
os menus e botões necessários. Ambos precisam de seleção exclusiva por ação;
o builder moderno também aceita/serializa flags conflitantes e precisa validá-las.

A implementação do cliente está no fork `R1quelmer/pokemon-showdown-client`,
branch `feat/copa-rinha-gimmick-ui`. O documento CLIENT.md preserva a análise
inicial do upstream. O cliente customizado oferece seleção exclusiva das
gimmicks, migra os IDs antigos para Gen 9 e oferece entrada por nickname local
na página Copa Rinha. Veja o README desse repositório para o acesso e deploy.
O preset Render aceita esses nomes sem assertion; não são autenticação segura
e outra pessoa que conheça o servidor pode usar um nome disponível.

## Desenvolvimento e validação

Requer Node >= 22.18 (validado com Node 24) e npm. Na raiz do checkout:

```sh
npm ci
npm run build
npm run tsc
npm run lint -- --max-warnings 0
npx mocha --no-config --exit test/main.js test/sim/othermetas/coparinha.js
# Suíte completa, incluindo testes lentos e de rede:
npx mocha --timeout 60000 --forbid-only -g '.*'
npm run test-npm
node pokemon-showdown start --skip-build 8000
```

O formato é de desafios (`searchShow: false`). Use o ID
`gen9coparinhanationaldexza` nos testes/integrações. Os testes incluem o exemplo
Venusaur → Dynamax, Lucario → Mega, Pikachu → Z e Garchomp → Tera para ambos os
jogadores; G-Max com Z-Crystal; opções simultâneas; limites independentes;
persistência após troca/fim do Dynamax; rejeição de flags conflitantes;
legalidade National Dex; Megas de Z-A e isolamento do formato oficial.

Casos específicos cobertos por testes automatizados:

| Caso | Evidência |
| --- | --- |
| Venusaurite oferece Mega + Dynamax + Tera | Os três campos existem simultaneamente na request ativa enviada |
| Pikachu com Pikanium Z e G-Max oferece Z + G-Max + Tera | Request inclui `canZMove`, `canDynamax`, `maxMoves.gigantamax` e `canTerastallize` |
| Venusaur após Dynamax não pode usar Mega/Tera | Comandos reais são rejeitados após os três turnos de Dynamax |
| Lucario ainda pode Mega e outro Pokémon ainda pode Tera | As duas ações são executadas após o Dynamax de Venusaur |
| Pikachu após G-Max não pode usar Z/Tera | Comandos reais são rejeitados após G-Max, também após sair e voltar ao campo |
| Outro Pokémon ainda pode usar Z e outro ainda pode Tera | As duas ações são executadas após o G-Max de Pikachu |
| Quatro mecânicas na mesma batalha, em Pokémon diferentes | Venusaur/Lucario/Pikachu/Garchomp executam as quatro para ambos os jogadores |
| Limite de uma ativação de cada mecânica por jogador | Segundo Pokémon ainda sem marcador tenta repetir cada mecânica e é rejeitado |
| Dynamax e G-Max compartilham a mesma utilização | Tentativas nas duas ordens são rejeitadas após o primeiro uso |
| Z-A disponível | As formas e pedras são liberadas somente na Copa Rinha; Clefable com Clefablite é legal |

Histórico de validação do protótipo anterior (antes da liberação de Z-A): build, TypeScript, `test-npm` e lint com zero avisos aprovados;
25 testes específicos da Copa Rinha aprovados. A primeira execução de
`npm run full-test` teve 2770 aprovados, 73 pendentes e seis timeouts em testes
de rede, com prazo de 8 segundos. A repetição dos testes de rede com prazo de
60 segundos confirmou que o DNS também fazia uma punição de teste expirar
(duração de 1 segundo). A entrada de loopback em `config/hosts.csv` corrige
essa dependência para `127/8`; consultas a outros endereços ainda são reais,
por isso a suíte completa usa prazo de 60 segundos neste ambiente. Nenhuma
asserção foi removida, nenhum teste extra foi desativado e nenhum resultado de
DNS foi simulado. O comando original `npm run full-test` continua usando 8
segundos; não deve ser confundido com a execução completa acima.

Resultado final da suíte completa com `--timeout 60000`: **2777 aprovados,
76 pendentes/ignorados declarados pelo runner, zero falhas**, incluindo os
25 testes da Copa Rinha. Os 76 pendentes não foram executados e não são
contados como aprovados. Na execução com timeouts, hooks interrompidos também
impediram testes seguintes de rodar; por isso as contagens não são idênticas.

Na configuração anterior, o servidor iniciou na porta 8000, respondeu ao
endpoint SockJS de informações e anunciou o formato pela conexão WebSocket.
O validador também aceitou a equipe Venusaurite, Lucarionite, Pikachu com
Pikanium Z e G-Max, Garchomp e Arceus.

As Megas de Z-A agora usam os mesmos limites de Mega das antigas: várias
pedras são aceitas por equipe, mas somente um Pokémon pode efetivamente Mega
Evoluir por jogador. O inventário e os dados de referência estão em [ZA.md](./ZA.md).

## G-Max automático no Teambuilder oficial Gen 9

A regra `Copa Rinha Mechanics` normaliza `set.gigantamax = true` em
`onChangeSet` quando **a forma exata** tem `canGigantamax` no Dex do mod.
Não há lista manual nem fallback indiscriminado para a espécie base: formas
regionais/caps sem elegibilidade continuam sem G-Max, enquanto Toxtricity-Low-Key
e Urshifu-Rapid-Strike usam os dados/movimentos correspondentes à própria forma.

O hook é executado antes das checagens de legalidade de espécie/G-Max. O validator
assíncrono reempacota o time modificado; o construtor nativo de Pokemon recebe a
flag e `getDynamaxRequest` envia `maxMoves.gigantamax` e o G-Max Move adequado.
A preservação prévia de elegibilidade nas formas Mega do mod continua atendendo
às checagens prospectivas do validator; não foi alterada. Não há mudança no
motor, nas condições de Dynamax ou nos limites/exclusividade das gimmicks.

Não é necessário `Gigantamax: Yes`. Para espécies elegíveis, `Yes` continua
válido e `No` é normalizado para `true`, conforme a política da Copa. Espécies
sem G-Max continuam com Dynamax normal; flags manuais inválidas continuam
rejeitadas pelo validator. Fora da regra Copa não ocorre essa normalização.

Após deploy do servidor, no psim.us selecione Copa Rinha II, crie/importe um time
sem a linha Gigantamax e valide-o novamente. Exemplo legal:

```text
Pikachu @ Pikanium Z
Ability: Static
EVs: 1 HP
Tera Type: Water
- Volt Tackle

Charizard @ Charizardite X
Ability: Blaze
EVs: 1 HP
Tera Type: Water
- Flamethrower

Zapdos
Ability: Pressure
EVs: 1 HP
Tera Type: Water
- Thunderbolt
```

Desafie outra sessão e teste cada Pokémon em partidas separadas ou conforme o
uso único de Max por jogador. Pikachu deve oferecer G-Max Volt Crash, Charizard
G-Max Wildfire e Zapdos Max Lightning normal. Antes de escolher uma gimmick,
Pikachu mantém Z/Tera e Charizard mantém Mega/Tera. Após usar uma delas, o mesmo
Pokémon perde as demais; os recursos não utilizados continuam disponíveis aos
companheiros. O checkbox G-Max continuará ausente no teambuilder Gen 9, o que é
esperado. Não é necessário deploy de client nem qualquer alteração em R2/replays.

Regressão ponta a ponta: `test/sim/othermetas/coparinha-auto-gmax.js` recebe um
time empacotado sem flag, usa o validator assíncrono real pelo alias oficial,
reempacota/desempacota, cria a batalha e verifica a request ativa, o marcador
Gmax no protocolo e o movimento executado, além dos casos de formas e gimmicks.

Validação desta alteração: `npm run build`, `npm run tsc -- --noEmit` e
`npm run lint` aprovados; 154 testes passaram, incluindo os 9 novos testes de
G-Max automático, as suítes Copa/Mega Z-A e as regressões de protocolo, política,
Search/Challenge, Render e replay com armazenamento mockado. Não houve teste de
R2 real nem mudança de client nesta etapa.
