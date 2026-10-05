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
import {
  DB_WRITE_BUFFERS,
  IPFS_CONNECTION_CHOICES,
  IPFS_WRITE_BUFFERS,
  PEER_LEVEL_CHOICES,
  pendingNodeOptions,
  restartRisk,
} from './advanced-settings'
import {ipfsConnectionsFor} from '../../../main/node-peers'
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
 * The built-in node's Advanced settings: its peer level and IPFS connection limit (main/node-peers.js), and
 * the write buffers of its chain database and IPFS datastore (main/node-write-buffer.js). The node takes them
 * at its start: while it runs with others, a line offers a restart (not during the validation), and so does a
 * dialog right after a change. A setting the node binary has no flag for (an official one) is disabled.
 */
export function AdvancedNodeSettings() {
  const {t} = useTranslation()

  const settings = useSettingsState()
  const {setNodeOptions} = useSettingsDispatch()
  const {
    nodeStarted,
    nodeOptions: running,
    nodeOptionsSupported: supported,
  } = useNodeState()
  const epoch = useEpochState()

  const [isConfirming, setIsConfirming] = React.useState(false)

  const pending = settings.runInternalNode
    ? pendingNodeOptions({nodeStarted, running, supported, settings})
    : []
  const risk = restartRisk(new Date(), epoch)

  // Saves `options`, and asks for the restart at once when the setting `title` is one the node does not run
  // with now.
  const save = (title, options) => {
    setNodeOptions(options)
    setIsConfirming(
      pendingNodeOptions({
        nodeStarted,
        running,
        supported,
        settings: {...settings, ...options},
      }).some((it) => it.title === title)
    )
  }

  const peerLevel =
    PEER_LEVEL_CHOICES.find(({value}) => value === settings.peerLevel) ??
    PEER_LEVEL_CHOICES[1]
  const ipfsConnections = ipfsConnectionsFor(
    settings.ipfsConnections,
    peerLevel.value
  )
  const dbBuffer =
    DB_WRITE_BUFFERS.find(({mib}) => mib === settings.dbWriteBufferMiB) ??
    DB_WRITE_BUFFERS[2]
  const ipfsBuffer =
    IPFS_WRITE_BUFFERS.find(({mib}) => mib === settings.ipfsWriteBufferMiB) ??
    IPFS_WRITE_BUFFERS[0]
  const unsupported = (flag) =>
    settings.runInternalNode && supported?.[flag] === false

  return (
    <Stack spacing={4}>
      {pending.length > 0 && (
        <Stack isInline spacing={3} align="center">
          <Text flex={1} color="muted">
            {t('Restart to apply: {{settings}}', {
              settings: pending.map((it) => t(it.title)).join(', '),
              nsSeparator: '!!',
            })}
          </Text>
          <SecondaryButton onClick={() => setIsConfirming(true)}>
            {t('Restart')}
          </SecondaryButton>
        </Stack>
      )}
      <NodeOptionRow
        title={t('Peer level')}
        description={
          unsupported('peerLimits')
            ? t('The node in use cannot change it: it runs with Normal', {
                nsSeparator: '!!',
              })
            : `${t('How many Idena nodes this node stays connected to')}. ${t(
                peerLevel.detail,
                {nsSeparator: '!!'}
              )}`
        }
        value={peerLevel.value}
        isDisabled={!settings.runInternalNode || unsupported('peerLimits')}
        onChange={(value) =>
          save('Peer level', {
            peerLevel: value,
            ipfsConnections: ipfsConnectionsFor(
              settings.ipfsConnections,
              value
            ),
          })
        }
        options={PEER_LEVEL_CHOICES.map((choice) => ({
          value: choice.value,
          label: `${t(choice.label)} · ${t('up to {{count}} peers', {
            count: choice.maxPeers,
          })}`,
        }))}
      />
      <NodeOptionRow
        title={t('IPFS connections')}
        description={
          unsupported('peerLimits')
            ? t('The node in use cannot change it: it runs with 50', {
                nsSeparator: '!!',
              })
            : t(
                'Flips and posts travel over them, and the node finds its Idena peers among them. Fewer connections use less traffic'
              )
        }
        value={ipfsConnections}
        isDisabled={!settings.runInternalNode || unsupported('peerLimits')}
        onChange={(value) =>
          save('IPFS connections', {ipfsConnections: Number(value)})
        }
        options={IPFS_CONNECTION_CHOICES.map(({high, label}) => {
          const allowed = ipfsConnectionsFor(high, peerLevel.value) === high
          return {
            value: high,
            isDisabled: !allowed,
            label: allowed
              ? t(label)
              : `${t(label)} · ${t('too few for {{level}}', {
                  level: t(peerLevel.label),
                })}`,
          }
        })}
      />
      <NodeOptionRow
        title={t('Chain database write buffer')}
        description={
          unsupported('dbWriteBuffer')
            ? t('The node in use cannot change it: it runs with 4 MiB', {
                nsSeparator: '!!',
              })
            : `${t(dbBuffer.detail)}. ${t(
                'Fewer disk writes for more memory; the node takes it when it starts'
              )}`
        }
        value={dbBuffer.mib}
        isDisabled={!settings.runInternalNode || unsupported('dbWriteBuffer')}
        onChange={(value) =>
          save('Chain database write buffer', {
            dbWriteBufferMiB: Number(value),
          })
        }
        options={DB_WRITE_BUFFERS.map(({mib, label}) => ({
          value: mib,
          label: `${mib} MiB · ${t(label)}`,
        }))}
      />
      <NodeOptionRow
        title={t('IPFS database write buffer')}
        description={
          unsupported('ipfsWriteBuffer')
            ? t('The node in use cannot change it: it runs with 4 MiB', {
                nsSeparator: '!!',
              })
            : t(
                'It writes the most when nodes outside can reach this computer. Fewer disk writes for more memory'
              )
        }
        value={ipfsBuffer.mib}
        isDisabled={!settings.runInternalNode || unsupported('ipfsWriteBuffer')}
        onChange={(value) =>
          save('IPFS database write buffer', {
            ipfsWriteBufferMiB: Number(value),
          })
        }
        options={IPFS_WRITE_BUFFERS.map(({mib, label}) => ({
          value: mib,
          label: mib === 4 ? `${mib} MiB · ${t(label)}` : t(label),
        }))}
      />
      <Dialog
        isOpen={isConfirming}
        onClose={() => setIsConfirming(false)}
        title={t('Restart the node?')}
      >
        <DialogBody>
          <Text>
            {t('The node takes these at its next start:', {nsSeparator: '!!'})}
          </Text>
          <Box as="ul" pl={5} mt={1}>
            {pending.map((it) => (
              <li key={it.title}>{`${t(it.title)}: ${t(it.value)}`}</li>
            ))}
          </Box>
          <Text mt={2}>
            {t(
              'A restart takes a few minutes: the node opens its databases and looks for peers again.',
              {nsSeparator: '!!'}
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
    </Stack>
  )
}

/** One Advanced setting: its title and description, and a menu of `options` ({value, label, isDisabled}). */
function NodeOptionRow({
  title,
  description,
  value,
  options,
  isDisabled,
  onChange,
}) {
  return (
    <Stack isInline spacing={3} align="center">
      <Box flex={1}>
        <Text fontWeight={500}>{title}</Text>
        <Text color="muted">{description}</Text>
      </Box>
      <Box>
        <Select
          value={value}
          isDisabled={isDisabled}
          borderColor="gray.300"
          h={8}
          onChange={(e) => onChange(e.target.value)}
        >
          {options.map((option) => (
            <option
              key={option.value}
              value={option.value}
              disabled={option.isDisabled}
            >
              {option.label}
            </option>
          ))}
        </Select>
      </Box>
    </Stack>
  )
}
