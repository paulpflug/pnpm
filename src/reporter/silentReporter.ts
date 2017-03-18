import {Log} from 'pnpm-logger'

export default (streamParser: {on: Function}) => {
  streamParser.on('data', (obj: Log) => {
    if (obj.level !== 'error') return

    console.log(obj['err'] && obj['err'].message || obj['message'])
  })
}
