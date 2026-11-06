# Avisa Ai! — Protótipo versão 2

Evolução do arquivo Vigilanse_Sprint_1.zip de outubro/2026. Mantém o visual, cadastro, login, reporte e avisos locais. Preserva identificadores Android/iOS e chaves locais para manter compatibilidade com a instalação anterior. Nome visível atualizado para Avisa Ai!.

## Novidades

- Status **Aberta**, **Em andamento** e **Resolvida**; o autor pode alterar ou reabrir. Resolução não apaga histórico.
- Detalhes ao tocar em uma ocorrência; comentários com autor, data e até 1.000 caracteres. Qualquer usuário autenticado pode comentar, inclusive em ocorrências resolvidas.
- Filtros por status; indicador da navegação conta apenas ocorrências não resolvidas.
- Captura automática de GPS ao abrir o formulário: solicita permissão somente em primeiro plano, registra latitude, longitude, precisão e instante. Tenta converter em endereço; se falhar, mantém coordenadas. Confira o local antes de enviar.
- Botão para tentar a localização novamente. Permissão negada, serviços desligados ou timeout de 15 segundos permitem informar manualmente. Editar o local remove as coordenadas automáticas para evitar associar um endereço diferente ao GPS.
- API Python + SQLite incluída para compartilhar dados entre aparelhos. Sincronização a cada 10 segundos enquanto o app está ativo, e botão Atualizar agora. Não há push remoto nem monitoramento em segundo plano.

## Atualização para SDK 58

Este pacote foi atualizado para Expo SDK 58, com dependências alinhadas pelo Expo CLI.
No Windows, extraia o ZIP em uma nova pasta, abra essa pasta no VS Code e execute:

```powershell
npm.cmd ci
npx.cmd expo start --clear
```

Encerre o servidor Expo antigo com Ctrl+C antes de iniciar. Abra o novo QR Code no Expo Go compatível com SDK 58. Se você já configurou uma API, copie o seu `.env` para a nova pasta; para manter dados do backend, preserve também o arquivo `server/avisa.db`. Não copie `node_modules` da versão anterior.

## Executar rapidamente (modo local)

Pré-requisitos: Node.js compatível com Expo SDK 58 e Expo Go compatível com esse SDK.

```bash
npm ci
npx expo start
```

Leia o QR Code no Expo Go, com computador e celular na mesma rede. Para problemas de acesso ao Metro, tente `npx expo start --tunnel`. O túnel do Expo não expõe a API.

Sem `EXPO_PUBLIC_API_URL`, contas, comentários e ocorrências permanecem no aparelho. É possível trocar de conta no mesmo aparelho para demonstrar os comentários; celulares diferentes **não** sincronizam nesse modo. A autenticação local original é apenas demonstrativa e armazena a senha localmente: use dados fictícios.

Ocorrências locais antigas ganham status Aberta e comentários vazios ao carregar. Não se inventa GPS para registros antigos. Nenhum dado local é enviado automaticamente à API.

## Compartilhar entre dois celulares

Pré-requisito adicional: Python 3.10 ou superior. API de desenvolvimento, sem bibliotecas Python adicionais.

1. Inicie a API no computador. Para aceitar conexões da sua rede local:

Windows PowerShell:
```powershell
$env:AVISA_HOST="0.0.0.0"
python server/server.py
```

macOS/Linux:
```bash
AVISA_HOST=0.0.0.0 python3 server/server.py
```

2. Copie `.env.example` para `.env`. Configure o IP real do computador na rede local:
```dotenv
EXPO_PUBLIC_API_URL=http://192.168.1.100:8000
```
O IP acima é exemplo. No Windows, consulte `ipconfig`. Não use localhost no celular: ele apontaria para o próprio celular. A porta 8000 precisa estar acessível apenas na rede privada de teste. Não abra essa API de demonstração diretamente à Internet.

3. Reinicie o Expo para carregar a configuração:
```bash
npx expo start --clear
```

4. Nos dois aparelhos, abra o projeto e crie contas pela API. Contas locais antigas são separadas: cadastre-se novamente. Registre uma ocorrência com uma conta e comente com a outra. Ambos devem usar a mesma URL de API.

5. A API mantém os dados em `server/avisa.db`, inclusive após reiniciar. O computador deve permanecer ligado. Para APK/iOS distribuído fora do ambiente local, hospede o backend atrás de HTTPS e configure a URL antes de gerar o app; restrições nativas podem bloquear HTTP simples. O servidor padrão liga apenas em 127.0.0.1 se AVISA_HOST não for definido.

A API é um backend acadêmico para testes. Usa senhas derivadas por PBKDF2, tokens de sessão com validade de 7 dias, identidade obtida do token e autorização do autor. Para produção ainda requer servidor HTTP apropriado, HTTPS, limitação de tentativas, revisão de autenticação/armazenamento seguro do token, backups, paginação e política de retenção/moderação. No modo compartilhado, todas as contas autenticadas veem o local da ocorrência, inclusive as coordenadas capturadas. Não use dados reais sensíveis em uma demonstração.

## Gerar APK

```bash
npx eas-cli@latest login
npm run build:apk
```

O EAS solicitará a conta/projeto e gerará um link de download. Este pacote contém **código-fonte**, não um APK compilado. Configure EXPO_PUBLIC_API_URL no ambiente do EAS para um APK compartilhado; sem ela, o APK usa modo local. A nova permissão nativa de localização exige recompilar instalações anteriores.

## Endpoints da API

| Método | Caminho | Função |
| --- | --- | --- |
| GET | /health | Testar disponibilidade |
| POST | /auth/register | Cadastro: name, email, password, cnh |
| POST | /auth/login | Login: email, password; retorna user e token |
| POST | /auth/logout | Revoga a sessão atual |
| GET | /incidents | Lista ocorrências e comentários |
| POST | /incidents | Registra type, location, description e coordinates opcional |
| POST | /incidents/:id/status | Altera status; somente autor |
| POST | /incidents/:id/comments | Adiciona text; identidade vem do token |

Rotas protegidas usam `Authorization: Bearer <token>`. O servidor define IDs, datas, autor e status inicial; não aceita identidade enviada pelo cliente. Comentários concorrentes são serializados em transação SQLite para evitar perda de atualizações.

Variáveis opcionais do servidor: AVISA_HOST, PORT (8000), AVISA_DB (caminho do SQLite), AVISA_CORS_ORIGIN (origem específica, caso desenvolva uma interface web). O alvo validado deste pacote é Android, não navegador.

## Verificações realizadas

- `npm run check`: TypeScript sem erros no SDK 58.
- `npx expo install --check`: dependências compatíveis.
- `npx expo-doctor@latest`: 20/20 verificações aprovadas.
- `npx expo export --platform android`: bundle Android gerado.
- `python3 -m unittest discover -s server -v`: fluxo HTTP com duas contas, credenciais inválidas, autorização de status, campos inválidos, cinco comentários simultâneos, identidade do autor, persistência SQLite e logout.

Não foi executado em aparelho físico nem gerado APK neste ambiente. A captura real de GPS, diálogos de permissão, teclado e layout precisam do teste abaixo.

## Roteiro de aceite em aparelho

1. Abrir Nova ocorrência e permitir localização; confirmar endereço/coordenadas e enviar.
2. Negar permissão ou desligar localização; verificar aviso e enviar com endereço manual.
3. Alterar manualmente o endereço durante a busca; confirmar que o resultado tardio não sobrescreve a digitação.
4. Tocar na ocorrência; mudar para Em andamento e depois Resolvida; conferir filtros e contador.
5. Com outra conta, publicar comentário; conferir que não aparecem controles de status.
6. No modo API, repetir com dois celulares; aguardar até 10 segundos ou tocar Atualizar agora.
7. Reiniciar app e API e confirmar persistência. Desligar API e verificar erro visível, sem mensagem falsa de sucesso.
8. Voltar ao modo local e verificar preservação dos registros da Sprint 1.

## Localização: referência técnica

Implementação usa expo-location compatível com o SDK instalado, permissão em primeiro plano e leitura pontual, conforme https://docs.expo.dev/versions/v58.0.0/sdk/location/ . Não precisa de chave paga de mapas. A conversão em endereço depende da disponibilidade dos serviços do dispositivo.
