# Publicação e atualizações do Lume

O Lume pode ser distribuído gratuitamente. A identidade de **Lume Leitor** na Microsoft Store está configurada. O repositório público de versões do instalador ainda precisa ser conectado. Nenhum comando deste projeto publica arquivos automaticamente.

## Gerar o instalador agora

```powershell
npm install
npm run build
npm run package:installer
```

O instalador fica em `release/installers/Lume-Setup-0.8.4-x64.exe`. Esta versão reúne os nove aplicativos do hub, incluindo a Oficina de Escrita Acadêmica. O número acompanha a versão de `package.json`. Este é um instalador completo, que funciona sem baixar componentes durante a instalação. Distribua o instalador que está em `release/installers/`.

Em uma instalação para o usuário atual, o destino padrão é a pasta **Lume** dentro de **Programas** do seu perfil, normalmente `%LOCALAPPDATA%\Programs\Lume`. Em uma atualização, o instalador sugere o local onde o Lume já está instalado. Ele cria a pasta escolhida quando tem acesso e verifica se consegue gravar nela antes de substituir a instalação.

Se o Windows bloquear o destino, abra o instalador novamente e escolha a pasta padrão. Se precisar usar o mesmo local protegido e tiver permissão, clique com o botão direito no arquivo `Lume-Setup` e selecione **Executar como administrador**. Para atualizar com o Lume aberto, use **Arquivo → Sair** antes de prosseguir.

Os livros, notas e progresso continuam em `%APPDATA%/Lume` ou na pasta de livros escolhida em Armazenamento. Use pastas separadas para os arquivos do aplicativo e os dados da biblioteca.

O instalador de teste atual não possui certificado de assinatura: o Windows poderá mostrar um aviso de editor desconhecido. Para assinar, configure o certificado no ambiente de build e informe o titular em `publisherName`. Nunca coloque certificado, senha ou token em `release.config.json`, no código-fonte ou no chat. A versão da Store utiliza a assinatura oferecida pela própria loja.

O electron-builder lê, por exemplo, `CSC_LINK` e `CSC_KEY_PASSWORD` do ambiente para usar um certificado. Informe em `publisherName` o nome do titular correspondente; assim, as futuras atualizações também verificam a assinatura do publicador.

## Conectar o GitHub quando criar a conta/repositório

1. Crie um repositório **público para as versões** no GitHub. O código-fonte pode ficar em outro repositório.
2. Edite os campos `github.owner` e `github.repo` em `release.config.json`. Exemplo do bloco `github`:

```json
{
  "github": { "owner": "seu-usuario", "repo": "lume-releases" }
}
```

3. Execute `npm run release:check` para conferir a configuração.
4. Execute `npm run release:prepare`. Ele compila e gera o instalador, `.blockmap` e `latest.yml` em `release/installers`, sem publicar.
5. Crie uma release no GitHub com a tag da versão atual de `package.json`, como `v0.8.1`, começando como rascunho. Anexe o instalador, seu `.blockmap` e `latest.yml` **da mesma compilação**.
6. Confira os arquivos e publique a release como versão estável. Não substitua os arquivos de uma versão já publicada; corrija o número e crie outra release.

Após conectar o repositório, é preciso **gerar e instalar uma vez o novo instalador**. A edição distribuída sem endereço de publicação não consegue descobrir sozinha um repositório criado depois. Alterar `release.config.json` não modifica um aplicativo já instalado.

Para uma próxima atualização, aumente `version` em `package.json`, gere os arquivos e publique uma nova release estável com a mesma configuração de repositório. Não altere `appId`, `productName` ou `app.setName('Lume')` entre versões: essas identidades mantêm a instalação e a pasta de dados estáveis.

As consultas são públicas e não exigem token no aplicativo. `LUME_RELEASE_REPOSITORY=usuario/repositorio` pode substituir o repositório durante o build; não define um endereço em tempo de execução. Credenciais de publicação não entram no pacote. Não há servidor próprio para manter nesta configuração.

## O que o leitor verá

O botão de versão na barra lateral abre o painel com o número da versão instalada. Na edição da Microsoft Store, o painel também indica que as atualizações vêm pela loja.

- Quando o instalador avulso tem um canal conectado, o ícone na barra superior também abre **Sobre e atualizações**. **Verificar atualizações**, **Baixar atualização** e **Salvar leitura e reiniciar para atualizar** são ações separadas.
- A verificação ao iniciar é opcional e vem desligada. A consulta não transmite livros, notas ou dados de leitura.
- O download pode continuar com o painel fechado. O aplicativo não instala ao fechar, nem reinicia sozinho.
- O motor verifica SHA-512 do download e a assinatura quando há um titular de certificado configurado. Uma falha de integridade impede a instalação.
- A instalação aguarda salvar a posição. Operações de biblioteca e exportação de audiobook precisam terminar ou ser canceladas antes do reinício.
- Uma falha de rede não impede a leitura. Versões de teste e downgrades não são oferecidos pelo canal estável.

## Preparar a Microsoft Store

1. O nome **Lume Leitor** está reservado no Partner Center. Os valores da página **Identidade do Produto** estão em `release.config.json`.
2. Execute `npm run build` e `npm run package:store`. Para a versão 0.8.1, o pacote Windows x64 fica em `release/store/Lume-Store-0.8.1-x64.appx`.
3. Na submissão do Lume Leitor no Partner Center, abra **Pacotes** e envie o arquivo `.appx`. O pacote inclui o ícone do aplicativo e as imagens de logotipo exigidas pelo manifesto.
4. Preencha a ficha da loja com descrição, capturas, endereço de suporte e política de privacidade. Complete as propriedades, a classificação etária, o preço e a disponibilidade.
5. Teste em uma máquina limpa a importação, o OCR, a narração com voz do Windows e os processos auxiliares. Envie a submissão e acompanhe a certificação no Partner Center. As atualizações dessa edição são gerenciadas pela Store.

A edição da Store pode ter uma pasta de dados virtualizada diferente. Para migrar a biblioteca existente, crie um backup no Lume atual e restaure-o na edição da Store. Essa migração precisa ser validada com a identidade real antes da publicação; os arquivos da biblioteca atual não são movidos ou apagados pelo empacotamento.

## Validação antes de publicar uma versão

Verifique instalação/atualização sobre a versão anterior com livros, notas, cartões e progresso de teste. Faça também um backup.

Testes novos: `tests/updates-core.spec.ts` verifica os estados, proteção contra instalação prematura, falhas, Store e configuração; `tests/updates.spec.ts` verifica a interface e usa o motor real para baixar de um servidor local, conferir SHA-512 e rejeitar um arquivo adulterado **sem executar o arquivo de teste**.

`node scripts/smoke-installer.mjs` testa instalação, reinstalação e desinstalação reais em pasta temporária do projeto, incluindo livro, marcador, cartão e retomada. O teste recusa execução se já houver um Lume instalado ou aberto; use uma máquina de testes para repetir. Ele mantém o perfil pessoal e restaura atalhos preexistentes.

Consulte a documentação de [atualizações do electron-builder v26](https://www.electron.build/v26/docs/features/auto-update/), [NSIS](https://www.electron.build/v26/docs/nsis/), [publicação no GitHub](https://www.electron.build/v26/docs/publish/) e [requisitos de pacotes MSIX e AppX](https://learn.microsoft.com/pt-br/windows/apps/publish/publish-your-app/msix/app-package-requirements).
