# Hockey Planner

Planificador de atividades de hockey com arena interativa e banco de exercícios local.

## Executar

Na raiz do projeto, execute:

```sh
uv sync
uv run hockeyplanner
```

Abra [http://127.0.0.1:8000](http://127.0.0.1:8000) em um navegador moderno. Crie uma conta com nome de usuário, e-mail e senha. Use o nome de usuário ou o e-mail para entrar. Contas antigas sem e-mail precisam cadastrá-lo após entrar pela primeira vez com o nome de usuário. Para alterar o endereço depois, clique no próprio nome no cabeçalho. No PyCharm, também é possível executar `src/main.py` com o interpretador da pasta `.venv`.

## Montar um exercício

- Em **Layout**, escolha **Full rink**, **Half rink** ou **Quarter rink**. O quarto de pista é cortado nos dois eixos, com uma margem além da linha horizontal do meio para preservar o gol e sua área.

- Escolha um marcador e clique na arena para posicioná-lo. Clique em **Player** para ver as equipes. O azul é o padrão. Escolha **Team B** para colocar um jogador vermelho. Use **Referee** para colocar um árbitro. Em **Select and Move**, use **Shift + clique** para selecionar vários jogadores e escolha uma cor no controle **Player** para alterá-los juntos. Use **Shot on goal** para indicar o ponto de onde sai o chute.
- Para indicar a sequência do exercício, escolha **Step number**, selecione um número de 1 a 9 e clique na arena.
- Escolha um movimento e o formato da linha. Arraste do ponto inicial ao destino. Ao desenhar uma curva, desvie o cursor durante o arraste para controlar a curvatura. Escolha **Freehand** para seguir o cursor com curvas suavizadas.
- Use **Select and Move** para reposicionar ou excluir um elemento. Ao selecionar um gol, use os botões de rotação para girá-lo em passos de 15°. Para mover vários elementos, arraste um retângulo a partir de uma área livre para envolvê-los. Depois, arraste um dos elementos selecionados. Segure **Shift** para iniciar o retângulo sobre um elemento. Os botões de desfazer e refazer afetam as alterações na arena.
- Preencha o nome e a descrição. Use **Save Drill** para adicioná-la ao banco ou atualizar a versão já salva.
- Use **PNG** ou **PDF** para baixar a arena com o nome e a descrição da atividade.

O aplicativo salva atividades e planos em `data/hockeyplanner.sqlite3`, na máquina que executa o servidor. Os dados são privados por conta e ficam disponíveis após fechar o navegador ou reiniciar o servidor. A primeira conta criada recebe o banco existente no servidor, inclusive os planos. Crie essa conta no computador antes de habilitar o acesso pela rede. Ao abrir a versão atualizada no mesmo endereço e perfil em que você salvou atividades anteriormente, o aplicativo importa esses registros para o SQLite.

Para acessar o mesmo banco pelo celular, execute `uv run hockeyplanner --host 0.0.0.0` no computador e abra `http://<IP-do-computador>:8000` no celular conectado à mesma rede. Entre com a mesma conta para acessar seus dados. O servidor local usa HTTP. Em redes públicas, sirva o aplicativo por um proxy HTTPS e inicie-o com `--secure-cookies`.

## Consultar atividades e planos

Use **Drill Library** no cabeçalho para listar os exercícios salvos e abri-los no editor. **Practice Plans** abre a página dos planos e das atividades que fazem parte de cada um.

## Organizar um plano de treino

Abra **Practice Plans**, clique em **New Plan**, dê um nome e selecione uma ou mais atividades salvas na ordem em que serão executadas. Você pode reabrir as atividades pelo plano, editar a seleção ou excluir o plano. Os planos ficam no mesmo banco do aplicativo.

Use **View Fullscreen** em um plano para percorrer as atividades na ordem salva. Use **Previous** e **Next** ou as setas esquerda e direita do teclado e use **Exit Presentation** para voltar à lista.

## Administrar contas

A primeira conta do aplicativo recebe o perfil `poweruser`. Em instalações existentes, a conta mais antiga recebe esse perfil ao atualizar. Entre com essa conta e abra **Administration** para alterar o perfil de outras contas, desativar ou reativar acessos e redefinir senhas. Desativar uma conta ou redefinir sua senha encerra as sessões dessa conta. Os exercícios e planos permanecem vinculados ao seu proprietário.

## Compartilhar planos

Abra **Share** em um plano e informe o nome de usuário do destinatário. O plano aparece em **Shared with me** na conta dele, com acesso somente para leitura. **Copy to My Account** cria um plano e cópias independentes dos exercícios no banco do destinatário. O proprietário pode retirar o acesso ao original. O destinatário também pode removê-lo de **Shared with me** sem afetar cópias já feitas.

Em **Share**, também é possível criar um link. Quem recebe o link precisa entrar e aceitar o compartilhamento. Desativar o link impede novos aceites. Na mesma janela, **Remove access** retira o acesso de quem já aceitou.
