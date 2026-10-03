/* eslint-disable react/prop-types */
import * as React from 'react'
import {
  Box,
  Button,
  Flex,
  FormControl,
  IconButton,
  InputGroup,
  InputRightElement,
  Select,
  Stack,
  Text,
  useClipboard,
  useToast,
} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {QRCodeSVG as QrCode} from 'qrcode.react'
import {useMachine} from '@xstate/react'
import {createMachine} from 'xstate'
import {assign} from 'xstate/lib/actions'
import {
  InfoButton,
  PrimaryButton,
  SecondaryButton,
} from '../../shared/components/button'
import {
  Checkbox,
  Dialog,
  DialogBody,
  DialogFooter,
  FormLabel,
  Input,
  Toast,
  Tooltip,
} from '../../shared/components/components'
import {FillCenter} from '../oracles/components'
import {callRpc, eitherState} from '../../shared/utils/utils'
import {
  useNodeDispatch,
  useNodeState,
} from '../../shared/providers/node-context'
import {importKey} from '../../shared/api/dna'
import {
  useSettingsDispatch,
  useSettingsState,
} from '../../shared/providers/settings-context'
import {useEpochState} from '../../shared/providers/epoch-context'
import {NODE_COMMAND} from '../../../main/channels'
import {DB_WRITE_BUFFERS, restartRisk, writeBufferPending} from './write-buffer'
import {AVAILABLE_LANGS, isoLangs} from '../../i18n'
import {EyeIcon, EyeOffIcon} from '../../shared/components/icons'

export function ExportPrivateKeyDialog({onClose, ...props}) {
  const {t} = useTranslation()

  const [current, send] = useMachine(
    createMachine({
      initial: 'password',
      states: {
        password: {
          entry: [assign({password: ''})],
          on: {
            CHANGE_PASSWORD: {
              actions: [
                assign({
                  password: (_, {value}) => value,
                }),
              ],
            },
            ENCODE: 'encoding',
            RESET: 'password',
          },
        },
        encoding: {
          invoke: {
            // eslint-disable-next-line no-shadow
            src: ({password}) => callRpc('dna_exportKey', password),
            onDone: 'encoded',
            onError: 'fail',
          },
        },
        encoded: {
          entry: [
            assign({
              encodedPrivateKey: (_, {data}) => data,
            }),
          ],
          on: {
            RESET: 'password',
          },
        },
        fail: {},
      },
    })
  )

  const {password, encodedPrivateKey} = current.context

  const is = (state) => eitherState(current, state)

  const [revealPassword, setRevealPassword] = React.useState()

  const {onCopy} = useClipboard(encodedPrivateKey)

  return (
    <Dialog
      size="mdx"
      title={t('Export private key')}
      onClose={onClose}
      {...props}
    >
      <DialogBody minH={48}>
        {is('password') && (
          <Stack spacing={5}>
            <Text color="muted" fontSize="mdx">
              {t('Create a new password to export your private key')}
            </Text>
            <FormControl>
              <FormLabel>{t('New password')}</FormLabel>
              <InputGroup>
                <Input
                  id="password"
                  type={revealPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => {
                    send('CHANGE_PASSWORD', {value: e.target.value})
                  }}
                />
                <InputRightElement h="full">
                  <IconButton
                    icon={revealPassword ? <EyeOffIcon /> : <EyeIcon />}
                    size="xs"
                    bg={revealPassword ? 'gray.300' : 'white'}
                    fontSize={20}
                    w={8}
                    _hover={{
                      bg: revealPassword ? 'gray.300' : 'white',
                    }}
                    onClick={() => setRevealPassword(!revealPassword)}
                  />
                </InputRightElement>
              </InputGroup>
            </FormControl>
          </Stack>
        )}
        {is('encoded') && (
          <Stack spacing={5}>
            <Text color="muted" fontSize="mdx">
              {t(
                'Scan QR by your mobile phone or copy code below for export private key.'
              )}
            </Text>
            <FillCenter>
              <QrCode value={encodedPrivateKey} />
            </FillCenter>
            <FormControl>
              <Stack spacing={1}>
                <Flex justify="space-between" align="center">
                  <FormLabel>{t('Encrypted private key')}</FormLabel>
                  <Button
                    variant="link"
                    colorScheme="blue"
                    fontWeight={500}
                    _hover={null}
                    _active={null}
                    onClick={onCopy}
                  >
                    {t('Copy')}
                  </Button>
                </Flex>
                <Input type="password" value={encodedPrivateKey} isDisabled />
              </Stack>
            </FormControl>
          </Stack>
        )}
      </DialogBody>
      <DialogFooter>
        <SecondaryButton
          onClick={() => {
            send('RESET')
            onClose()
          }}
        >
          {t('Close')}
        </SecondaryButton>
        {is('password') && (
          <PrimaryButton
            isDisabled={!password}
            onClick={() => {
              send('ENCODE')
            }}
          >
            {t('Export')}
          </PrimaryButton>
        )}
      </DialogFooter>
    </Dialog>
  )
}

export function ImportPrivateKeyDialog(props) {
  const {t} = useTranslation()

  const toast = useToast()

  const {importNodeKey} = useNodeDispatch()

  const [password, setPassword] = React.useState()

  const [key, setKey] = React.useState()

  const [shouldResetNode, setShouldResetNode] = React.useState()

  const submit = async () => {
    try {
      const {error} = await importKey(key, password)
      if (error) {
        toast({
          status: 'error',
          // eslint-disable-next-line react/display-name
          render: () => (
            <Toast
              title={t('Error while importing key')}
              description={error.message}
              status="error"
            />
          ),
        })
      } else {
        importNodeKey(shouldResetNode)
        toast({
          // eslint-disable-next-line react/display-name
          render: () => (
            <Toast
              title={t('Success')}
              description={t(
                'Key was imported, please, wait, while node is restarting'
              )}
            />
          ),
        })
        setKey('')
        setPassword('')
      }
    } catch (e) {
      toast({
        status: 'error',
        // eslint-disable-next-line react/display-name
        render: () => (
          <Toast
            title={t('Error while importing key')}
            description={t(
              'Internal node is not available, try again in a few seconds'
            )}
            status="error"
          />
        ),
      })
    }
  }

  const [revealPassword, setRevealPassword] = React.useState()

  return (
    <Dialog title={t('Import private key')} {...props}>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          await submit()
          // eslint-disable-next-line react/destructuring-assignment
          props.onClose()
        }}
      >
        <DialogBody>
          <Stack spacing={5} mt={3}>
            <FormControl>
              <FormLabel htmlFor="key">{t('Encrypted private key')}</FormLabel>
              <Input
                value={key}
                type="text"
                onChange={(e) => setKey(e.target.value)}
              />
            </FormControl>
            <FormControl>
              <FormLabel htmlFor="password">{t('Password')}</FormLabel>
              <InputGroup>
                <Input
                  id="password"
                  value={password}
                  type={revealPassword ? 'text' : 'password'}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <InputRightElement h="full">
                  <IconButton
                    icon={revealPassword ? <EyeOffIcon /> : <EyeIcon />}
                    size="xs"
                    bg={revealPassword ? 'gray.300' : 'white'}
                    w={8}
                    _hover={{
                      bg: revealPassword ? 'gray.300' : 'white',
                    }}
                    onClick={() => {
                      setRevealPassword(!revealPassword)
                    }}
                  />
                </InputRightElement>
              </InputGroup>
            </FormControl>
            <FormControl>
              <Stack isInline>
                <Checkbox
                  isChecked={shouldResetNode}
                  onChange={(e) => {
                    setShouldResetNode(e.target.checked)
                  }}
                >
                  {t('Re-sync node from scratch')}
                </Checkbox>
                <Tooltip
                  label={t(
                    'Please re-sync the node if you want to have an up-to-date transaction history for the new address. It will take some time to re-sync.'
                  )}
                  zIndex="tooltip"
                >
                  <InfoButton />
                </Tooltip>
              </Stack>
            </FormControl>
          </Stack>
        </DialogBody>
        <DialogFooter>
          {/* eslint-disable-next-line react/destructuring-assignment */}
          <SecondaryButton type="button" onClick={props.onClose}>
            {t('Close')}
          </SecondaryButton>
          <PrimaryButton type="submit" disabled={!password || !key}>
            {t('Import')}
          </PrimaryButton>
        </DialogFooter>
      </form>
    </Dialog>
  )
}

export function LocaleSwitcher() {
  const {i18n} = useTranslation()

  const {changeLanguage} = useSettingsDispatch()

  return (
    <Select
      value={i18n.language}
      borderColor="gray.300"
      h={8}
      onChange={(e) => {
        const nextLanguage = e.target.value
        i18n.changeLanguage(nextLanguage)
        changeLanguage(nextLanguage)
      }}
    >
      {AVAILABLE_LANGS.map((lang) => (
        <option key={lang} value={lang}>
          {isoLangs[lang].nativeName} ({lang.toUpperCase()})
        </option>
      ))}
    </Select>
  )
}

/**
 * The built-in node's chain database write buffer: a size from DB_WRITE_BUFFERS, taken by the node at its
 * start. When it changes while the node runs, a dialog offers a restart (not during the validation).
 */
export function WriteBufferSetting() {
  const {t} = useTranslation()

  const settings = useSettingsState()
  const {setDbWriteBuffer} = useSettingsDispatch()
  const {
    nodeStarted,
    dbWriteBufferMiB: runningMiB,
    dbWriteBufferSupported: supported,
  } = useNodeState()
  const epoch = useEpochState()

  const [isConfirming, setIsConfirming] = React.useState(false)

  const chosenMiB = settings.dbWriteBufferMiB
  const chosen =
    DB_WRITE_BUFFERS.find(({mib}) => mib === chosenMiB) ?? DB_WRITE_BUFFERS[2]
  const isPending =
    settings.runInternalNode &&
    writeBufferPending({nodeStarted, runningMiB, chosenMiB, supported})
  // A node binary without the flag (an official one) runs with idena-go's 4 MiB whatever the choice.
  const isUnsupported = settings.runInternalNode && supported === false
  const risk = restartRisk(new Date(), epoch)

  return (
    <>
      <Stack isInline spacing={3} align="center">
        <Box flex={1}>
          <Text fontWeight={500}>{t('Database write buffer')}</Text>
          <Text color="muted">
            {/* eslint-disable-next-line no-nested-ternary */}
            {isUnsupported
              ? t('The node in use cannot change it: it runs with 4 MiB', {
                  nsSeparator: '!!',
                })
              : isPending
              ? t('The node uses {{size}} MiB until it restarts', {
                  size: runningMiB,
                })
              : `${t(chosen.detail)}. ${t(
                  'Fewer disk writes for more memory; the node takes it when it starts'
                )}`}
          </Text>
        </Box>
        {isPending && (
          <SecondaryButton onClick={() => setIsConfirming(true)}>
            {t('Restart')}
          </SecondaryButton>
        )}
        <Box>
          <Select
            value={chosen.mib}
            isDisabled={!settings.runInternalNode || isUnsupported}
            borderColor="gray.300"
            h={8}
            onChange={(e) => {
              const mib = Number(e.target.value)
              setDbWriteBuffer(mib)
              setIsConfirming(
                settings.runInternalNode &&
                  writeBufferPending({
                    nodeStarted,
                    runningMiB,
                    chosenMiB: mib,
                    supported,
                  })
              )
            }}
          >
            {DB_WRITE_BUFFERS.map(({mib, label}) => (
              <option key={mib} value={mib}>
                {`${mib} MiB · ${t(label)}`}
              </option>
            ))}
          </Select>
        </Box>
      </Stack>
      <Dialog
        isOpen={isConfirming}
        onClose={() => setIsConfirming(false)}
        title={t('Restart the node?')}
      >
        <DialogBody>
          <Text>
            {t(
              'The node uses the {{size}} MiB write buffer from its next start. A restart takes a few minutes: the node opens its database and looks for peers again.',
              {size: chosen.mib, nsSeparator: '!!'}
            )}
          </Text>
          {risk && (
            <Text color="red.500" mt={2}>
              {t(risk.message, {nsSeparator: '!!'})}
            </Text>
          )}
        </DialogBody>
        <DialogFooter>
          <SecondaryButton onClick={() => setIsConfirming(false)}>
            {t('Later')}
          </SecondaryButton>
          <PrimaryButton
            isDisabled={risk?.canRestart === false}
            onClick={() => {
              setIsConfirming(false)
              global.ipcRenderer.send(NODE_COMMAND, 'restart-node')
            }}
          >
            {t('Restart now')}
          </PrimaryButton>
        </DialogFooter>
      </Dialog>
    </>
  )
}
