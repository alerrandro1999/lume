# Versão do Lume para Mac

A preparação para gerar DMG e ZIP está implementada, mas a versão de Mac ainda precisa ser compilada e passar pela verificação em um runner macOS. A rotina local de Windows não produz um instalador de Mac validado.

## Geração sem possuir um Mac

No repositório `alerrandro1999/lume`, o arquivo `.github/workflows/macos.yml` disponibiliza o workflow **Instalador macOS**. Ele usa runners macOS do GitHub Actions e gera dois pacotes independentes:

- `arm64`: MacBooks com chip Apple, M1 ou posterior.
- `x64`: Macs Intel.

Esta primeira configuração exige macOS 15 ou posterior. A transcrição usa a CPU, com os mesmos modelos Base e Small do Windows. Os componentes nativos são compilados a partir das revisões fixadas do Whisper e do FFmpeg; o aplicativo instalado não depende de Homebrew. A voz usa AVFoundation, com as vozes instaladas no macOS. A voz desejada deve estar disponível nas configurações de acessibilidade do computador.

Depois de enviar as alterações para o repositório:

1. Abra **Actions → Instalador macOS → Run workflow**.
2. Escolha `preview` para gerar uma prévia de teste. Ela usa assinatura local e não possui notarização Apple; não é uma distribuição pronta para clientes.
3. Aguarde os dois jobs. Antes de disponibilizar os arquivos, a rotina verifica os nove apps, leitura, narração real, conversão M4A, transcrição de áudio e salvamento na oficina.
4. Baixe os arquivos em **Artifacts**. Cada arquitetura contém DMG, ZIP e SHA-256. Não é criada uma release pública nem enviado nada para a App Store.

O acesso, a disponibilidade e a cobrança de runners dependem da conta e do plano do GitHub. O workflow só executa quando iniciado manualmente, tem limite de 60 minutos por job e mantém os artefatos por 14 dias. Confira a franquia da conta antes de executar.

## Distribuição aos clientes

Para produzir pacotes assinados e notarizados, escolha `signed` e configure os segredos do repositório:

- `MAC_CSC_LINK`: certificado Developer ID Application em formato aceito pelo electron-builder.
- `MAC_CSC_KEY_PASSWORD`: senha do certificado.
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` e `APPLE_TEAM_ID`: credenciais para a notarização.

Essas credenciais ficam nos segredos do GitHub Actions, nunca no código ou no chat. A geração assinada falha se faltarem credenciais; ela não transforma silenciosamente uma distribuição em prévia. Antes de enviar a uma instituição, teste também os fluxos de instalação, gravação do microfone e uso diário em um Mac físico.

## Gerar diretamente em macOS

Requer Node 24, pnpm 10, Xcode Command Line Tools, Git, Make e CMake, na arquitetura do Mac:

```sh
cd desktop
pnpm install --frozen-lockfile
pnpm run build
pnpm run package:mac
node scripts/smoke-macos.mjs
```

Os arquivos ficam em `desktop/release/macos/`. Para a distribuição assinada, configure as variáveis correspondentes e execute `pnpm run package:mac --signed`.

O suporte ao Mac e a prévia não alteram o instalador Windows 0.8.4 já gerado. Os dados dos usuários no Mac ficam no diretório de dados do Lume escolhido pelo Electron, normalmente `~/Library/Application Support/Lume`.

Fontes: [runners do GitHub](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [empacotamento macOS](https://www.electron.build/v26/docs/mac/), [notarização](https://www.electron.build/v26/docs/notarization/), [Whisper 1.8.4](https://github.com/ggml-org/whisper.cpp/releases/tag/v1.8.4) e [FFmpeg 8.1.3](https://github.com/FFmpeg/FFmpeg/releases/tag/n8.1.3).
