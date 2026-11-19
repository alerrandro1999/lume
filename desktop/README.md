# Lume — Leitor PDF e EPUB

Aplicativo desktop em Electron, React e TypeScript. PDF.js renderiza PDFs e epub.js apresenta EPUBs com texto que se adapta à janela e à fonte escolhida.

## Usar no Windows

Os instaladores de teste macOS 0.8.4 para chip Apple e Intel foram gerados e validados pelo GitHub Actions. Consulte [MACOS.md](MACOS.md) para os requisitos, a geração e as etapas restantes de assinatura e distribuição.

O instalador atual, com os nove aplicativos do hub, é `release/installers/Lume-Setup-0.8.4-x64.exe`. Esse é o arquivo para distribuir a outros computadores.

Para testar a versão atual sem instalar, use **Iniciar Lume.cmd**. O atalho prioriza `release/installers/win-unpacked/Lume.exe`. Mantenha os arquivos da pasta `win-unpacked` juntos; o executável depende deles. Saia da versão anterior por **Arquivo → Sair** antes de abrir a nova ou executar o instalador.

Na tela inicial, selecione **Lume Leitor** para abrir a biblioteca. O botão **Aplicativos**, na barra superior do leitor, volta para o hub com as demais ferramentas.

Na versão 0.8, também é possível gerar um instalador com `npm run package:installer` após `npm run build`. O arquivo fica em `release/installers/`. O botão **Sobre e atualizações**, na versão ou na barra superior, permite acompanhar o canal de atualização. O download e a instalação são manuais; a consulta ao iniciar é opcional. Sem um repositório conectado, o aplicativo informa a indisponibilidade das atualizações on-line e continua funcionando offline.

Veja [PUBLICACAO.md](PUBLICACAO.md) para configurar GitHub Releases, gerar o instalador e preparar o pacote da Microsoft Store. `release.config.json` contém somente dados públicos; começa sem repositório nem identidade da Store. Os comandos de empacotamento não publicam na internet.

Use **Importar livro**, **Ctrl + O** ou arraste um arquivo para guardar uma cópia na biblioteca do Lume. Para usar o arquivo na pasta original, escolha **Abrir sem copiar** ou **Ctrl + Shift + O**. Experimente `examples/Primeiros passos.pdf` e `examples/Entre páginas.epub`.

Recursos disponíveis:

- Leitura página a página com transição lateral, setas nas bordas e gestos horizontais em telas de toque.
- Modo livro aberto com duas páginas lado a lado (capa isolada), além da opção de rolagem contínua.
- Preferência de modo de leitura lembrada entre sessões, com seleção e cópia de texto em todos os modos.
- Navegação por página e pelo sumário incorporado, quando disponível.
- Zoom, ajuste à largura, página inteira e rotação.
- Botões **A− / A+** para reduzir ou ampliar o texto. O PDF inteiro é ampliado, preservando a diagramação; a preferência de zoom é lembrada para cada modo de leitura, inclusive ao reabrir o aplicativo.
- Busca no texto com **Ctrl + F**.
- Biblioteca com os 500 livros PDF e EPUB mais recentes, capas e autor quando disponíveis, marcador da página em que você parou, porcentagem e botão para continuar a última leitura.
- Progresso destacado no rodapé, navegação pela barra e confirmação da gravação automática da página.
- Temas claro e escuro, barra lateral recolhível e tela cheia com **F11**.
- Solicitação de senha em PDFs protegidos.
- **Texto ajustável**: fonte, tamanho, espaçamento e largura das linhas independentes do zoom do PDF.
- **Ouvir**: vozes locais do Windows, pausa, retomada, velocidade, navegação por trechos e destaque do parágrafo narrado. A narração avança para a próxima página quando há texto disponível.
- **Anotações**: selecione um trecho no PDF, no EPUB ou no modo texto para destacar em quatro cores e acrescentar comentários. O painel permite navegar, editar e excluir os registros.
- **Marcadores pessoais**: páginas salvas com nomes, renomeação e navegação direta.
- **Conforto**: fundo claro, sépia ou escuro, régua que acompanha o cursor e modo foco com **F8**.
- **OCR offline**: reconhecimento em português e inglês da página atual ou do documento inteiro, com progresso e cancelamento. Páginas que já têm texto ou já foram reconhecidas são preservadas no reconhecimento do documento inteiro.

Esta versão aceita arquivos de até 300 MB. Em PDFs digitalizados, use **Reconhecer texto** para habilitar seleção, busca, anotações e narração. Os modelos de OCR acompanham a distribuição; o reconhecimento não exige internet. A qualidade do reconhecimento depende da imagem da página. No modo texto, imagens e tabelas ficam disponíveis no PDF original; a ordem de leitura de documentos complexos pode exigir conferência.

Os arquivos originais permanecem onde estão. As cópias importadas ficam em `%APPDATA%/Lume/books/`. O histórico e a posição atual ficam em `%APPDATA%/Lume/library.json`. Anotações, marcadores e texto reconhecido ficam em `%APPDATA%/Lume/documents/`, em arquivos separados por documento. Tema, fonte, modo de leitura, ampliação e velocidade da voz ficam no armazenamento local do aplicativo. Remover um item da lista não apaga a cópia, o original, as anotações ou o progresso; reimportar o mesmo conteúdo recupera os registros arquivados. Os documentos não são enviados a serviços externos. Somente uma consulta manual de significado ou tradução envia o trecho escolhido ao serviço indicado no painel.

Para PDFs, em **Modo de leitura**, escolha **Página a página**, **Livro aberto (2 páginas)**, **Rolagem contínua** ou **Texto ajustável**. Use as setas laterais ou as teclas **← / →** para virar uma página ou uma dupla de páginas. A porcentagem indica a posição no documento, reservando 100% para a última página. No modo de duas páginas, o marcador e a porcentagem consideram a última página da dupla em exibição; ao reabrir, o aplicativo retoma essa mesma dupla. A barra de progresso permite saltar diretamente para outra página.

No PDF, para aumentar apenas a fonte, escolha **Texto ajustável** e use **A+ / A−**, ou abra **Conforto** para escolher a fonte e o espaçamento. A numeração continua correspondendo às páginas do PDF original. A busca também percorre o texto das páginas reconhecidas por OCR.

Em **Ouvir**, escolha uma voz instalada e ajuste a velocidade entre 0,5× e 2×. A voz é sintetizada localmente pelo Windows e o áudio é reproduzido por trechos. O ícone ao lado de um parágrafo do modo texto inicia a leitura naquele trecho. Use o botão **Player flutuante** na barra de narração para controlar o trecho enquanto usa outros aplicativos. Se uma página não possui texto, o aplicativo solicita reconhecimento antes de continuar. Em **Estudo → Audiobook**, gere arquivos WAV e use **Abrir audiobook no player** para ouvir os capítulos em ordem na mesma sessão.

EPUBs sem DRM oferecem paginação, duas páginas, rolagem, sumário, busca, anotações, marcadores e narração local. Use **A+ / A−** diretamente no livro para ajustar a fonte; **Conforto** permite escolher também a família, o espaçamento e o fundo. Como as páginas mudam com a fonte e a janela, mostramos a seção atual, a página dentro dela e a porcentagem do livro. O trecho salvo usa uma âncora EPUB CFI, preservada ao alterar a fonte. A barra de progresso percorre o livro inteiro. Livros com DRM não são suportados. Layout fixo, fontes ofuscadas e diagramações específicas podem apresentar limitações.

## Estudo e organização (v0.5)

- **Estudo → Ritmo**: estimativa para o livro e a seção/página atual, ou capítulo identificado no sumário do PDF; meta diária e lembretes opcionais de pausa. O ritmo inicial é configurável (200 palavras/min por padrão). A calibração pessoal usa três amostras válidas, excluindo saltos de navegação e narração. O contador pausa com a janela oculta/inativa, após dois minutos sem interação, durante as pausas e com o painel de estudo aberto. Até nove segundos ainda não gravados podem ser perdidos se o processo for encerrado abruptamente.
- **Histórico**: voltar e avançar entre saltos por sumário, busca, página, progresso, notas e cartões. Use **Alt + ← / →**. O histórico é da sessão de leitura; o marcador automático permanece separado.
- **Biblioteca**: buscar por título/autor/etiquetas; filtrar formato, situação, coleção e favoritos. Clique em **Organizar** no cartão do livro para editar os campos. A biblioteca comporta até 500 arquivos.
- **Consultar**: selecione uma palavra/trecho e use a ação da seleção, ou abra **Estudo → Consultar**. Consultas de significado vão ao [Wikcionário](https://pt.wiktionary.org/); traduções ao [MyMemory](https://mymemory.translated.net/doc/spec.php), com origem/destino escolhidos e limite de 500 bytes por consulta. As chamadas ocorrem somente ao clicar em Consultar; o arquivo inteiro nunca é enviado. O resultado identifica o serviço; o conteúdo do Wikcionário é atribuído como CC BY-SA. A tradução automática depende da disponibilidade e dos [limites do serviço](https://mymemory.translated.net/doc/usagelimits.php).
- **Cartões**: criar pergunta/resposta da seleção ou de uma anotação, editar/excluir e voltar ao trecho de origem. As revisões pendentes são locais: Repetir em um minuto, Difícil/Bom/Fácil com intervalos crescentes, até 365 dias.
- **Anotações**: exportar destaques, comentários e marcadores para Markdown ou PDF em uma pasta escolhida; inclui nome do livro, página/seção e CFIs do EPUB.
- **Margens (PDF)**: detecção pela página atual e ajuste manual por lado, até 30%. O recorte visual é lembrado por livro e preserva o arquivo e as coordenadas das anotações/OCR. Verifique páginas com diagramação diferente; restaurar margens remove o ajuste. O modo Texto ajustável apresenta o texto integral.
- **Audiobook**: gerar a seção/página atual ou o livro inteiro com uma voz instalada no Windows. EPUB: WAV por seção; PDF: WAV por capítulo do sumário ou por página. A pasta nova contém arquivos WAV, playlist M3U e manifesto JSON. Só o texto extraível/reconhecido é narrado; o painel informa páginas/seções sem texto. WAVs podem ocupar bastante espaço. O progresso e o cancelamento são locais; arquivos incompletos da exportação cancelada são removidos. A narração normal usa um processo independente.

Metas, cartões, tempo ativo, calibração e recortes são salvos em `%APPDATA%/Lume/study.json`; organização e favoritos ficam em `library.json`. As preferências, notas e posições da versão anterior continuam disponíveis. Os testes `features.spec.ts` e `study-core.spec.ts` verificam esses recursos, persistência, exportações reais e cancelamento. As integrações on-line são simuladas nos testes para não transmitir trechos dos livros.

## Narração, estudo e exportação

- Use **Continuar ouvindo** para voltar à posição da narração. Ao trocar de voz, o Lume retoma no início do trecho salvo.
- Na barra de narração, escolha uma duração para o temporizador ou deixe o áudio pausar no fim da página ou seção. O botão de reproduzir e pausar do teclado ou fone também controla o áudio ativo do Lume.
- Os audiobooks aparecem em **Estudo → Audiobook** depois de reiniciar o Lume. Para um audiobook antigo ou movido, use **Vincular audiobook já gerado** e escolha a pasta que contém `Livro.json`.
- Depois de reconhecer texto em um PDF, use **Salvar cópia pesquisável** no painel de OCR. O texto é incluído nas páginas que já foram reconhecidas. A exportação requer um PDF sem criptografia.
- Abra **Revisar a página** no modo **Texto ajustável** ou no painel de OCR. A prévia original fica ao lado dos blocos. Você pode subir, descer ou ignorar blocos e voltar à ordem automática. O Lume procura colunas e mantém cabeçalhos e rodapés repetidos fora do texto e da narração. Use a opção de incluí-los se precisar lê-los.
- Em uma página reconhecida, selecione um bloco para corrigir o texto. Use **Selecionar área para OCR** para refazer apenas uma parte da página antes de salvar. O painel destaca páginas abaixo de 75% de confiança inicial. A revisão salva vale para a busca do documento, a narração, os novos audiobooks e a cópia pesquisável. Use **Atualizar índice de conteúdo** para atualizar a busca global.
- Use **Salvar no glossário** após uma consulta para rever o significado ou a tradução e voltar ao trecho ou criar um cartão. Veja os totais e as sessões recentes de leitura e escuta em **Estudo → Ritmo**.

## Biblioteca com cópias locais (v0.6)

- **Importar livro** é a ação padrão, inclusive ao arrastar PDFs/EPUBs para a janela. A cópia usa uma gravação temporária seguida de renomeação; uma falha não deixa um livro parcialmente gravado com nome definitivo.
- O Lume compara SHA-256 dos bytes para reconhecer o mesmo arquivo com outro nome/local. Reimportar retoma a posição e as anotações, sem criar outra cópia. Uma edição com bytes diferentes é tratada como outro livro.
- **Abrir sem copiar** registra uma referência externa, indicada como **Arquivo externo**. Esse modo depende de o arquivo permanecer acessível. Se o livro já possui uma cópia válida na biblioteca, ela é reaproveitada.
- Livros antigos continuam como referências externas até você clicar em **Guardar no app** ou importá-los. A conversão conserva o identificador para manter notas, marcadores, cartões, recorte, organização e progresso. Se o arquivo tiver sido movido, Guardar no app permite localizá-lo; um conteúdo diferente é rejeitado quando já existe uma impressão digital registrada.
- A biblioteca mostra **Salvo no app** nas cópias. **Pasta dos livros** abre a pasta das cópias para consulta/backup. Os nomes físicos são hashes; títulos e nomes originais continuam visíveis no aplicativo. Faça backup da pasta inteira de dados do Lume para incluir também o catálogo, notas, cartões e posições.
- Ao remover da lista, o registro é arquivado e a cópia fica guardada. Não há exclusão automática do arquivo original ou da cópia; a exclusão explícita de cópias está em Armazenamento. O limite de 500 livros ativos produz uma mensagem, sem descartar livros antigos silenciosamente.
- As cópias locais são conferidas ao reimportar e reparadas se necessário. Uma referência externa cujo conteúdo mudou pode ser importada como uma nova edição, preservando os registros da anterior.

## Biblioteca e áudio (v0.7)

- **Importar em lote**: selecione vários PDFs/EPUBs ou uma pasta com subpastas. O relatório distingue importados, duplicatas, erros e arquivos ignorados. O cancelamento preserva os livros já importados. A biblioteca mantém o limite de 500 livros ativos.
- **Backup**: cria um ZIP com livros ativos/arquivados, referências externas acessíveis, notas, OCR, capas, progresso, cartões, metas e preferências. Áudios podem ser incluídos. Arquivos indisponíveis impedem o backup completo; uma opção explícita permite um pacote parcial. O arquivo ZIP contém os dados sem criptografia.
- **Restaurar**: confira o resumo do pacote e confirme a substituição do catálogo atual. O aplicativo verifica os caminhos e a integridade dos livros/áudios antes de trocar os metadados. Os metadados anteriores ficam em `%APPDATA%/Lume/recovery/<identificador>/`; arquivos originais e cópias já existentes são preservados. Em caso de falha na aplicação dos metadados, o catálogo anterior é recuperado. A tela reinicia com as preferências restauradas; o índice de busca é reconstruído separadamente.
- **Miniaturas**: no PDF, abra a faixa de prévias e clique para navegar. As imagens são geradas sob demanda, em grupos de até 30 páginas, com cache limitado.
- **Abas e comparação**: livros abertos ficam em abas lembradas entre sessões. **Comparar livros** abre outro PDF ou EPUB ao lado, com navegação, fonte/zoom, senha e posição independentes. As ferramentas de edição de notas continuam no leitor principal; o segundo leitor apresenta as anotações existentes.
- **Busca global**: pesquisa conteúdo indexado, anotações e marcadores sem enviar texto para a internet. Clique em **Atualizar índice de conteúdo** após importar livros ou reconhecer páginas por OCR. Acentos não impedem a busca. Resultados abrem a página do PDF ou o trecho CFI do EPUB. PDFs protegidos são ignorados na indexação; PDFs digitalizados precisam de OCR. O índice tem limite de 30 MB de texto por livro e a busca apresenta até 200 resultados.
- **Armazenamento**: mostra o espaço das cópias de PDF/EPUB, permite mudar a pasta e excluir uma cópia cadastrada após confirmação. A mudança cria uma subpasta **Lume Livros**, confere os arquivos e só então atualiza o catálogo. A remoção das cópias antigas é opcional. Excluir uma cópia arquiva notas e progresso para reimportação; o arquivo original é preservado. Um arquivo que também é origem cadastrada fica protegido. Áudios, notas e índices não entram no total de PDFs/EPUBs mostrado.
- **Player de audiobooks**: abre MP3, M4B, M4A e WAV locais, com velocidade de 0,5× a 3×, saltos de 15 segundos, posição salva, marcadores, capítulos presentes nos metadados e temporizador de sono. A reprodução continua ao fechar o painel ou minimizar o Lume. Depois de abrir um áudio, clique em **Player flutuante** para controlar a reprodução em uma janela que fica sobre os outros aplicativos. Arraste-a pela parte superior. Enquanto ela estiver aberta, o botão de fechar da janela principal oculta o leitor. **Arquivo → Sair** encerra o aplicativo. Os arquivos de áudio permanecem na origem; quando incluídos em um backup restaurado, ficam em `%APPDATA%/Lume/media/`. DRM e codecs incompatíveis não são suportados. Áudio gerado em **Estudo → Audiobook** também pode ser aberto no player.

As novas funções ficam na barra lateral. `electron/workspace.cjs` coordena backup/restauração, lotes e armazenamento; `electron/search-index.cjs` mantém o índice local e `electron/audio-player.cjs` serve áudio com suporte a intervalos para busca. Os testes `workspace-core.spec.ts` e `workspace.spec.ts` cobrem recuperação, adulteração, falhas de gravação, preservação de originais e os fluxos da interface.

## Planejador Acadêmico

Abra **Planejador Acadêmico** no hub. Cadastre disciplinas com nome, docente e cor. Em **Nova atividade**, registre uma tarefa, prova, trabalho, leitura ou revisão com prioridade, data, horário opcional e notas. A data também pode ficar em branco.

A **Agenda** tem busca, filtro por disciplina e períodos **Hoje**, **Esta semana** e **Atrasadas**. Ative **Mostrar concluídas** para consultar ou reabrir atividades finalizadas. O **Calendário** mostra os compromissos por dia e permite cadastrar uma atividade na data selecionada.

Em **Meta desta semana**, defina quantas atividades quer concluir. O progresso usa a data em que a atividade foi concluída, de segunda a domingo. Remover uma disciplina mantém as suas atividades em **Sem disciplina**.

Vincule um livro, uma gravação ou uma revisão bibliográfica já cadastrada no hub para abri-la pela atividade. Os dados do planejador ficam em `%APPDATA%/Lume/planner.json`. O backup da biblioteca de livros cobre os dados do Leitor.

## Treino de Apresentação

Abra **Treino de Apresentação** no hub do Windows. Crie uma apresentação com título, disciplina e público opcionais. Divida o roteiro em tópicos, anote os pontos principais e defina o tempo previsto para cada parte. Você pode adicionar, remover e reordenar os tópicos.

Clique em **Iniciar ensaio** para acompanhar o cronômetro e avançar pelo roteiro. **Gravar áudio do ensaio** é opcional e usa o microfone ao iniciar. Pause e retome quando precisar; voltar aos aplicativos pausa o ensaio. **Finalizar e salvar** guarda o tempo total e o tempo realizado em cada tópico. Fechar o aplicativo durante um ensaio também solicita a finalização da gravação.

No **Histórico**, ouça as gravações e compare o tempo realizado com o previsto. Registre sua autoavaliação em clareza, organização, domínio do conteúdo e ritmo, com notas sobre o que melhorar. Cada ensaio conserva uma cópia do roteiro utilizado. Exporte o relatório em Markdown (`.md`) ou o áudio em WebM (`.webm`). A avaliação é preenchida pelo estudante; não há análise automática da fala nesta versão.

Os dados ficam em `%APPDATA%/Lume/presentations/projects.json` e os áudios na mesma pasta. Em uma interrupção inesperada, o próximo início recupera os tempos e os trechos já salvos e identifica o ensaio como **Interrompido**. O backup da biblioteca de livros cobre os dados do Leitor.

## Mapas Conceituais

Abra **Mapas Conceituais** no hub do Windows e crie um mapa com um tema. Arraste os blocos **Ideia**, **Livro**, **Autor** e **Referência** da lateral para o quadro ou clique neles para adicionar. Dê dois cliques em um espaço livre para criar uma ideia. Selecione um bloco para editar seu nome, notas e cor.

Para conectar, arraste um dos pontos do bloco até outro bloco ou até um de seus pontos. Você também pode clicar no ponto de origem e depois no destino, inclusive com o teclado. Selecione a seta para escrever uma relação, mudar o traço e a cor ou inverter sua direção. Excluir um bloco remove suas conexões; **Desfazer** recupera o conjunto. **Ctrl+Z** desfaz, **Ctrl+Shift+Z** refaz e as setas do teclado movem o bloco em foco.

Em **Fontes do seu hub**, busque títulos e autores dos livros da biblioteca e das referências da Bancada. Arraste uma fonte para criar um bloco vinculado ou use **Vincular material** nos detalhes de uma ideia existente. **Abrir no hub** abre o livro no Leitor ou a referência selecionada na Bancada. Também é possível criar livros e autores manualmente.

Arraste o fundo para navegar, use a roda do mouse para zoom e **Enquadrar todo o mapa** para visualizar o conjunto. O minimapa permite navegar para outra região. As alterações são salvas automaticamente e o indicador superior confirma o salvamento. Cada mapa aceita até 500 blocos e 1.500 conexões.

Exporte uma **Imagem SVG** para compartilhar ou um **Mapa editável (JSON)** para guardar uma cópia. Importar o JSON cria outro mapa, preservando o original. Os dados ficam em `%APPDATA%/Lume/concept-maps.json`. O backup da biblioteca de livros cobre os dados do Leitor.

## Organizador de TCC e Projetos

Abra **Organizador de TCC e Projetos** no hub do Windows. Crie um TCC, uma pesquisa, um projeto de extensão ou outro projeto, com curso, estudante, orientador, equipe e prazo de entrega opcionais. Cada projeto recebe etapas iniciais sugeridas, que podem ser adaptadas ao trabalho.

Na **Visão geral**, acompanhe tarefas concluídas, etapas concluídas, atrasos e a agenda do projeto. Em **Plano do projeto**, registre tema, pergunta, objetivos, metodologia e notas. Clique em **Salvar plano do projeto**; a confirmação aparece em destaque na tela.

Em **Tarefas**, organize o trabalho nas colunas **A fazer**, **Em andamento**, **Em revisão** e **Concluída**. Arraste os cartões ou use o seletor de situação de cada tarefa. Registre prazo, prioridade, responsável, descrição e etapa vinculada; use a busca e o filtro por etapa. Em **Etapas**, edite os prazos e a situação de cada entrega. O progresso das tarefas de uma etapa é apresentado separadamente da sua situação. Excluir uma etapa mantém suas tarefas em **Sem etapa**.

Em **Orientações**, registre a data, o orientador, o que foi discutido e os próximos passos. Ao criar uma orientação, a opção **Criar tarefas para os próximos passos** transforma cada linha em uma tarefa, com prazo opcional. As tarefas podem ser editadas no quadro; editar ou excluir o registro da orientação não duplica nem exclui as tarefas.

Em **Materiais**, vincule livros, gravações, revisões bibliográficas, mapas conceituais e apresentações existentes no hub. **Abrir no hub** abre o conteúdo correspondente. Também é possível adicionar links HTTP/HTTPS e cópias de PDF, DOCX, ODT, TXT, Markdown, PPTX, XLSX, CSV, PNG e JPEG. Cada arquivo pode ter até 50 MB, com até 20 arquivos por seleção. Os arquivos adicionados são copiados para o aplicativo; remover um material exclui apenas a cópia cadastrada.

**Exportar** permite salvar um relatório Markdown com o plano, etapas, tarefas, orientações e lista de materiais, ou uma tabela CSV de tarefas. Os anexos não são incluídos nesses relatórios. Os projetos ficam em `%APPDATA%/Lume/research-projects.json` e as cópias dos arquivos em `%APPDATA%/Lume/project-files`. O backup da biblioteca de livros cobre os dados do Leitor.

## Portfólio Acadêmico e de Estágio

Abra **Portfólio Acadêmico e de Estágio** no hub do Windows. Em **Meu perfil**, registre nome, apresentação, curso, instituição, objetivos e contatos opcionais. Clique em **Salvar perfil** para gravar as alterações. O rascunho permanece disponível ao alternar as áreas durante a sessão.

Em **Minha trajetória**, adicione formação, experiências, projetos, cursos/certificações e atividades acadêmicas. Cada registro tem instituição, papel, período, descrição, resultados, competências relacionadas e link opcional. Use **Na apresentação** para escolher os registros exportados, marque destaques e organize a ordem dentro de cada categoria. **Trazer projeto do hub** copia o título e o objetivo de um projeto do Organizador de TCC para um registro editável, com acesso ao projeto original.

Cadastre uma experiência do tipo **Estágio** para usar o **Diário de estágio**. Registre data, atividade, horas, minutos e aprendizados. A meta de horas é opcional e fica no cadastro do estágio. Os totais usam os minutos registrados pelo estudante. **Exportar diário completo** gera um CSV com todas as atividades. O diário e suas horas não são incluídos automaticamente no PDF do portfólio.

Em **Competências**, registre habilidades técnicas, interpessoais e idiomas, com uma autoavaliação de prática. Nos **Comprovantes** de cada registro, guarde cópias de PDF, PNG, JPEG e DOCX, de até 20 MB por arquivo e até 10 arquivos por seleção. Remover um comprovante exclui a cópia cadastrada; o arquivo original é preservado. Excluir um registro também remove suas atividades de estágio e seus comprovantes, após confirmação.

Em **Prévia e exportação**, escolha uma das três cores e se contatos e competências aparecem na apresentação. A prévia usa a mesma composição do documento exportado. **Exportar** oferece PDF, página HTML independente e CSV do diário. PDF e HTML contêm o perfil e os registros selecionados, sem os arquivos dos comprovantes ou o diário. A página HTML pode ser aberta localmente em um navegador.

Os dados ficam em `%APPDATA%/Lume/portfolio.json` e as cópias dos comprovantes em `%APPDATA%/Lume/portfolio-files`. O backup da biblioteca de livros cobre os dados do Leitor.

## Desenvolvimento

Requisitos: Node.js 22.12 ou mais recente e npm ou pnpm.

```powershell
npm install
npm run dev
```

Comandos:

```powershell
npm run build       # verifica TypeScript e gera dist/
npm start           # abre o aplicativo usando dist/
npm test            # testa o aplicativo real com Playwright
npm run package     # gera a pasta de distribuição do Windows
```

Execute `npm run build` antes dos testes ou da distribuição. Com pnpm, use `pnpm install` e os mesmos comandos `pnpm run ...`. O projeto inclui `pnpm-lock.yaml` para reproduzir as versões utilizadas.

## Estúdio de Transcrição

Abra o card **Estúdio de Transcrição** na tela Aplicativos. O Estúdio aceita MP3, WAV e FLAC de até 700 MB e MP4 ou M4A de até 2 GB, com duração máxima de 2 horas. Selecione o idioma e clique em **Iniciar transcrição**. O padrão é português com a opção **Maior precisão**, que demora mais que **Mais rápido**. Os horários reproduzem o áudio a partir de cada trecho. Use a busca e o botão de edição para revisar o texto, depois exporte um TXT ou legendas SRT.

Use o botão **Marcar trecho** para salvar um ponto como **Importante**, **Dúvida** ou **Exemplo**, com uma nota opcional. Em **Para revisar**, clique no horário para ouvir só aquele trecho. As marcações são salvas por gravação. **Gerar nova versão** cria outro item com uma cópia das marcações e preserva a transcrição e as notas do item anterior.

- **Disciplina e glossário** agrupa gravações e salva termos técnicos para as próximas transcrições da disciplina. **Buscar nas aulas** encontra trechos em todas as gravações ou em uma disciplina e abre o áudio no horário da ocorrência.
- **Corrigir intervalo** abre a partir de um trecho da transcrição. Selecione o último trecho do intervalo (até 3 minutos), ouça a 0,75× e gere uma sugestão. Revise o texto antes de clicar em **Aplicar correção**.
- **Resumo e perguntas** reúne trechos representativos e exercícios de completar lacunas gerados localmente. Cada item aponta para sua fonte no áudio.
- Em **Para revisar**, crie um cartão a partir de uma marcação. **Cartões de aulas** aparece no Estúdio e na biblioteca do Lume Leitor. Abra um cartão, revele a resposta, agende a próxima revisão ou exporte os cartões em `.tsv` para importar no Anki.

As gravações são copiadas para `%APPDATA%\Lume\transcriptions`, junto com as transcrições e marcações. Para MP4 e M4A, o Estúdio guarda apenas a primeira faixa de áudio em FLAC. O backup da biblioteca de livros não inclui os projetos do Estúdio. Excluir um projeto apaga a cópia no aplicativo e mantém a gravação original.

O Estúdio roda localmente em Windows x64 e usa a CPU. Os modelos Whisper Base e Small e os binários do Whisper e do FFmpeg são baixados durante a primeira compilação (cerca de 334 MB) e incluídos na versão empacotada. Para preparar apenas esses arquivos, execute `npm run transcription:prepare`. Em computadores onde faltar a biblioteca de execução, instale o [Microsoft Visual C++ Redistributable x64](https://learn.microsoft.com/pt-br/cpp/windows/latest-supported-vc-redist). As licenças dos componentes estão em `resources/transcription`.

## Bancada de Revisão Bibliográfica

Abra a **Bancada de Revisão Bibliográfica** no hub e crie uma revisão. Use **Critérios da revisão** para registrar a pergunta e os critérios de inclusão e exclusão. Importe referências RIS, BibTeX (`.bib` ou `.bibtex`) ou CSV. No CSV, use uma coluna `Título` ou `Title` e, quando disponíveis, `Autores`, `Ano`, `DOI`, `Periódico`, `Resumo` e `URL`. As importações aceitam até 20 arquivos por vez, com 15 MB por arquivo e 30 MB no total.

A Bancada reúne duplicatas com o mesmo DOI ou com título, ano e sobrenome do primeiro autor coincidentes e sem DOI conflitante. **Referências e triagem** permite buscar, filtrar por etapa e registrar a decisão, o motivo de exclusão e as notas. Para itens incluídos, preencha a extração de evidências e reutilize o **ID do estudo** quando várias publicações relatarem o mesmo estudo.

Em **Fluxo PRISMA e exportações**, baixe a tabela de evidências e as contagens para o fluxograma [PRISMA 2020 de buscas em bases de dados e registros](https://www.prisma-statement.org/prisma-2020-flow-diagram). Os dois arquivos são CSV UTF-8 separado por ponto e vírgula. As contagens mostram pendências e deixam o número de estudos em aberto quando faltam IDs. O projeto, as decisões e os dados importados ficam em `%APPDATA%\Lume\bibliography`. O backup de livros do Lume não inclui essas revisões.

## Oficina de Escrita Acadêmica

No hub, abra **Oficina de Escrita Acadêmica** e crie um texto. Há roteiros para resumo, resenha, relatório de estágio, artigo, projeto de pesquisa e capítulo de TCC. Os títulos, as perguntas e a ordem das seções podem ser ajustados. O editor oferece negrito, itálico, subtítulos, listas e citações em bloco. A meta de palavras é opcional.

O indicador **Salvo neste computador** confirma a gravação automática. **Salvar versão** guarda uma cópia do trabalho e de suas fontes no histórico, com até 20 versões. Restaurar uma versão também guarda o texto atual antes da troca. Em caso de falha de gravação, mantenha o aplicativo aberto e use **Tentar salvar novamente** após conferir o espaço disponível.

Use **Citar fonte** para buscar livros da biblioteca ou referências da bancada bibliográfica, informar a página e editar a marca da citação. As fontes ficam vinculadas ao trecho e podem ser abertas na ferramenta de origem. O arquivo exportado reúne as referências efetivamente citadas nas seções incluídas. Os metadados são preservados no trabalho e nas versões, mesmo se a fonte original for removida depois. Confira os dados importados e adapte a formatação às orientações da instituição.

Ao criar um trabalho, é possível trazer o tema, o problema, o objetivo geral e a metodologia de um projeto do Organizador de TCC para consulta no guia, e vincular um mapa conceitual. Essas informações são uma cópia do planejamento no momento da criação. Perguntas do roteiro e notas privadas ficam fora das exportações. **Exportar** gera DOCX editável ou PDF A4; desmarque as seções que não devem ser incluídas.

A aba **Revisão** faz verificações locais de frases com mais de 35 palavras, parágrafos com mais de 120 palavras, palavras repetidas e marcadores de fonte ou tarefa. Os apontamentos levam ao trecho e não alteram a redação. Essa versão não analisa a qualidade dos argumentos, fatos, plágio ou todas as regras gramaticais, e não aplica automaticamente as normas da instituição.

Os trabalhos ficam em `%APPDATA%\Lume\academic-writing.json`. O backup da biblioteca de livros não inclui os textos da oficina.

## Organização

- `electron/main.cjs`: janela, protocolo local, seletor de arquivos e IPC validado.
- `electron/preload.cjs`: interface limitada entre o aplicativo e o sistema.
- `electron/library.cjs`: histórico e progresso salvos localmente, com gravação atômica.
- `electron/notebook.cjs`: armazenamento e validação de notas, marcadores e OCR.
- `electron/ocr.cjs`: Tesseract.js em worker, modelos locais e progresso.
- `electron/speech.cjs` e `electron/speech.ps1`: síntese local com as vozes do Windows; texto enviado por entrada padrão, sem interpolação em comandos.
- `src/App.tsx`: biblioteca e controles de leitura.
- `src/UnifiedReader.tsx` e `src/EpubReader.tsx`: seleção do motor, paginação EPUB, CFIs, sumário e realce nativo.
- `src/PdfReader.tsx`: integração do PDF.js, busca e renderização sob demanda.
- `src/text-extraction.ts`: organização do texto por linhas e parágrafos e detecção simples de colunas.
- `src/TextReader.tsx`, `src/ReadingTools.tsx` e `src/useReadingTools.ts`: texto ajustável, anotações, marcadores e conforto.
- `src/useNarrator.ts` e `src/SpeechBar.tsx`: reprodução de áudio e acompanhamento do trecho narrado.
- `resources/ocr/`: modelos locais em português e inglês e suas licenças.
- `tests/reader.spec.ts`: testes de renderização, navegação, busca, persistência e arquivos inválidos.
- `tests/epub.spec.ts`: EPUB com imagens e metadados, paginação, fonte, CFIs, busca, notas, narração, modos de leitura, retomada e biblioteca mista.
- `tests/book.spec.ts` e `tests/assistance.spec.ts`: modos de leitura, ampliação, fonte independente, anotações, persistência, narração real e OCR de PDFs digitalizados. O áudio dos testes é silenciado.

O renderizador opera com sandbox, isolamento de contexto e sem acesso direto ao Node.js. Scripts embutidos nos PDFs e EPUBs não são executados; o conteúdo EPUB é sanitizado e apresentado em iframes com sandbox. Recursos externos dos livros são bloqueados. O worker, as fontes e os recursos do PDF.js são distribuídos com o aplicativo para leitura offline.

Referências: [Electron](https://www.electronjs.org/docs/latest/), [PDF.js](https://mozilla.github.io/pdf.js/), [epub.js](https://github.com/futurepress/epub.js) e [Vite](https://vite.dev/guide/).

