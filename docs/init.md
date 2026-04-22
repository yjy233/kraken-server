npm init -y

npm pkg set name="kraken-server" private=true type="module"

npm pkg set scripts.dev="tsx watch src/server.ts"
npm pkg set scripts.build="tsc -p tsconfig.json"
npm pkg set scripts.start="node dist/server.js"
npm pkg set scripts.check="tsc --noEmit"


npm install -D typescript
npx tsc --init