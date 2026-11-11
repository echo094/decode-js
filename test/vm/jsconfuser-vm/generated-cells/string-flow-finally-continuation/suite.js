export default {
  name: 'string-flow-finally-continuation',
  protects:
    'A concealed string with a branch and a finally continuation. Not proved by a break: stack only.',
  files: {
    cells: [
      {
        sources: ['string-concealing-cff-finally-continuation'],
        profile: 'randomizeOpcodes+stringConcealing+controlFlowFlattening',
        seeds: [251, 252, 253],
      },
    ],
  },
}
