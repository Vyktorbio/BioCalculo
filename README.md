# BioCalculo

Calculadoras de aplicação para bioensaios e registro rastreável de ensaios de campo.

## Paginas

- `index.html`: entrada para Laboratório e Campo.
- `calda.html`: preparo de soluções, PPM, campo para bancada, ajuste de ingrediente ativo e séries.
- `campo.html`: fluxo guiado de aplicação de campo com identificação do ensaio, condições, equipamentos, calibração, tratamentos, lotes, desvios, GPS, fotos, revisões, PDF e backup.
- `campo-core.js`: fórmulas de Campo isoladas e testáveis.
- `campo.js`: persistência IndexedDB, integridade dos registros e interface BPL.

## Dados e integridade

- Os rascunhos são salvos automaticamente no navegador.
- Registros finalizados ficam protegidos contra edição.
- Correções criam uma revisão justificada sem substituir o original.
- Nenhum registro é excluído; itens incorretos são anulados com justificativa.
- Backups JSON incluem registros, eventos e evidências fotográficas.
- O hash SHA-256 identifica o conteúdo finalizado.

O aplicativo apoia a documentação de campo, mas não certifica conformidade BPL e não substitui os procedimentos ou o reconhecimento formal da instalação de teste.

## Testes

```sh
node --test tests/campo-core.test.js
```

Projeto estático, pronto para GitHub Pages e uso offline após o primeiro carregamento.
