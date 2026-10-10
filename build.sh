#!/bin/bash

MVN_OPTS="-Duser.home=/var/maven -T 4"

if [ ! -e node_modules ]
then
  mkdir node_modules
fi

case `uname -s` in
  MINGW* | Darwin*)
    USER_UID=1000
    GROUP_UID=1000
    ;;
  *)
    if [ -z ${USER_UID:+x} ]
    then
      USER_UID=`id -u`
      GROUP_GID=`id -g`
    fi
esac

# Options
NO_DOCKER=""
SPRINGBOARD="recette"
for i in "$@"
do
case $i in
  -s=*|--springboard=*)
  SPRINGBOARD="${i#*=}"
  shift
  ;;
  --no-docker*)
  NO_DOCKER="true"
  shift
  ;;
  *)
  ;;
esac
done

# If DEBUG env var is set to "true" then set -x to enable debug mode
if [ "$DEBUG" == "true" ]; then
	set -x
	EDIFICE_CLI_DEBUG_OPTION="--debug"
else
	EDIFICE_CLI_DEBUG_OPTION=""
fi

init() {
  me=`id -u`:`id -g`
  echo "DEFAULT_DOCKER_USER=$me" > .env

  # If CLI_VERSION is empty set to latest
  if [ -z "$CLI_VERSION" ]; then
    CLI_VERSION="latest"
  fi
  # Create a build.compose.yaml file from following template
  cat <<EOF > build.compose.yaml
services:
  edifice-cli:
    image: opendigitaleducation/edifice-cli:$CLI_VERSION
    user: "$DEFAULT_DOCKER_USER"
EOF
  # Copy /root/edifice from edifice-cli container to host machine
  docker compose -f build.compose.yaml create edifice-cli
  docker compose -f build.compose.yaml cp edifice-cli:/root/edifice ./edifice
  docker compose -f build.compose.yaml rm -fsv edifice-cli
  rm -f build.compose.yaml
  chmod +x edifice
  ./edifice version $EDIFICE_CLI_DEBUG_OPTION
}

clean () {
  if [ "$NO_DOCKER" = "true" ] ; then
    rm -rf node_modules
    rm -f yarn.lock
    gradle clean
  else
    docker compose run --rm maven mvn $MVN_OPTS clean
  fi
}

install () {
  docker compose run --rm maven mvn $MVN_OPTS install -DskipTests
}

test () {
  docker compose run --rm maven mvn $MVN_OPTS test
}

buildNode () {
  #jenkins
  echo "[buildNode] Get branch name from jenkins env..."
  BRANCH_NAME=`echo $GIT_BRANCH | sed -e "s|origin/||g"`
  if [ "$BRANCH_NAME" = "" ]; then
    echo "[buildNode] Get branch name from git..."
    BRANCH_NAME=`git branch | sed -n -e "s/^\* \(.*\)/\1/p"`
  fi
  if [ "$BRANCH_NAME" = "" ]; then
    echo "[buildNode] Branch name should not be empty!"
    exit -1
  fi

  if [ "$BRANCH_NAME" = 'master' ]; then
      echo "[buildNode] Use entcore version from package.json ($BRANCH_NAME)"
      case `uname -s` in
        MINGW*)
          if [ "$NO_DOCKER" = "true" ] ; then
            yarn install --no-bin-links && yarn upgrade entcore && node_modules/gulp/bin/gulp.js build
          else
            docker compose run --rm -u "$USER_UID:$GROUP_GID" node sh -c "yarn install --no-bin-links --legacy-peer-deps --force && yarn upgrade entcore && node_modules/gulp/bin/gulp.js build"
          fi
          ;;
        *)
          if [ "$NO_DOCKER" = "true" ] ; then
            yarn install && yarn upgrade entcore && node_modules/gulp/bin/gulp.js build
          else
            docker compose run --rm -u "$USER_UID:$GROUP_GID" node sh -c "yarn install --legacy-peer-deps --force && yarn upgrade entcore && node_modules/gulp/bin/gulp.js build"
          fi
      esac
  else
      echo "[buildNode] Use entcore tag $BRANCH_NAME"
      case `uname -s` in
        MINGW*)
          if [ "$NO_DOCKER" = "true" ] ; then
            yarn install && yarn upgrade entcore && node_modules/gulp/bin/gulp.js build
          else
            docker compose run --rm -u "$USER_UID:$GROUP_GID" node sh -c "yarn install --no-bin-links --legacy-peer-deps --force && npm rm --no-save entcore && yarn install --no-save entcore@dev && node_modules/gulp/bin/gulp.js build"
          fi
          ;;
        *)
          if [ "$NO_DOCKER" = "true" ] ; then
            yarn install --no-bin-links && yarn upgrade entcore && node_modules/gulp/bin/gulp.js build
          else
            docker compose run --rm -u "$USER_UID:$GROUP_GID" node sh -c "yarn install --legacy-peer-deps --force && npm rm --no-save entcore && yarn install --no-save entcore@dev && node_modules/gulp/bin/gulp.js build"
          fi
      esac
  fi
}

buildReact () {
  # IHM React (CCTP 51C), servie par view/timelinegenerator-react.html via
  # `frontend-ui: react` dans ent-core.yaml ou le paramètre d'URL `?ui=react`.
  # Sorties nommées `tlreact.*` (cf. frontend/vite.config.ts) pour ne pas écraser
  # le `public/index.js` de l'IHM edifice explorer, qui cohabite dans le même mod.
  echo "[buildReact] Build de l'IHM React (vite)..."
  # Ancien bundle supprimé d'abord : sinon un build en échec réutilisait en silence le précédent.
  # Ex. image node sans pnpm (« pnpm: not found ») → tlreact.js de la veille empaqueté sans erreur.
  rm -rf frontend/dist
  # pnpm via corepack (fourni avec Node ≥ 18). Pas dans le conteneur `node` du docker-compose :
  # il est en Node 16 (pour gulp), trop ancien pour pnpm (« requires at least Node.js v18.12»).
  local node_major
  node_major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
  if [ "$node_major" -lt 18 ] ; then
    echo "[buildReact] Node ≥ 18 requis sur la machine pour l'IHM React (trouvé : ${node_major})"; exit 1
  fi
  (cd frontend && corepack pnpm install --frozen-lockfile && corepack pnpm run build) || { echo "[buildReact] échec du build React"; exit 1; }
  [ -f frontend/dist/public/tlreact.js ] || { echo "[buildReact] tlreact.js absent"; exit 1; }

  echo "[buildReact] Injection des assets dans les ressources du backend..."
  cp -R frontend/dist/public/. src/main/resources/public/
  # La vue, elle, vit dans view-src/timelinegenerator-react.html (source suivie par
  # git) : c'est gulp qui la copie vers view/ en substituant @@VERSION, comme les
  # autres gabarits. frontend/dist/index.html ne sert qu'au serveur de dev.
}

publish() {
  version=`docker compose run --rm maven mvn $MVN_OPTS help:evaluate -Dexpression=project.version -q -DforceStdout`
  level=`echo $version | cut -d'-' -f3`
  case "$level" in
    *SNAPSHOT) export nexusRepository='snapshots' ;;
    *)         export nexusRepository='releases' ;;
  esac

  docker compose run --rm  maven mvn $MVN_OPTS -DrepositoryId=ode-$nexusRepository -DskipTests --settings /var/maven/.m2/settings.xml deploy
}

watch () {
  if [ "$NO_DOCKER" = "true" ] ; then
    node_modules/gulp/bin/gulp.js watch --springboard=../recette
  else
    docker compose run --rm -u "$USER_UID:$GROUP_GID" node sh -c "node_modules/gulp/bin/gulp.js watch --springboard=/home/node/$SPRINGBOARD"
  fi
}

if [ ! -e .env ]; then
  init
fi

for param in "$@"
do
  case $param in
    init)
      init
      ;;
    clean)
      clean
      ;;
    buildNode)
      buildNode
      ;;
    buildReact)
      buildReact
      ;;
    install)
      buildNode && buildReact && install
      ;;
    watch)
      watch
      ;;
    test)
      test
      ;;
    publish)
      publish
      ;;
    *)
      echo "Invalid argument : $param"
  esac
  if [ ! $? -eq 0 ]; then
    exit 1
  fi
done

