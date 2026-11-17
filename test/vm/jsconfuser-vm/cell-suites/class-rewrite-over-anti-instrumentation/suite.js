export default {
  name: 'class-rewrite-over-anti-instrumentation',
  protects:
    'A rewrite still finds handlers when the interpreter holds handlers built from the program. Not proved by a break: stack only.',
  files: {
    cells: [
      {
        sources: [
          'composition-finally-abrupt-return',
          'f-for-in-enumeration',
          'f-arrow-lexical-state',
        ],
        profile: 'randomizeOpcodes+antiInstrumentation+classObfuscation',
        seeds: [251],
      },
    ],
  },
}
