'use client';

// Tagged links: the list, the link maker and Remove. Ported from BetterFans
// Link's Traffic page (app/(app)/dashboard/traffic/page.tsx, main d4138f9).
// The package has no toasts: a made link is shown in its dialog with a Copy
// link button, and a removed one leaves the list (and is announced to screen
// readers). Each Make and each Remove opens a fresh dialog with its own
// request, so one link's error never shows on the next.
import { useId, useRef, useState, type FormEvent } from 'react';
import { Check, Copy, Link2, Trash2 } from 'lucide-react';
import { trafficLinkUrl } from '../shared/format';
import { normalizeLinkName, TRAFFIC_LINK_PLATFORMS, type TrafficLinkPlatform } from '../shared/origin';
import type { TrafficLink, TrafficSite } from '../shared/summary';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  COPY_FAILED,
  CopyButton,
  Dialog,
  DialogContent,
  EmptyState,
  Field,
  formatDate,
  formatNumber,
  InlineError,
  Input,
  Select,
  Spinner,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  useCopy,
} from '../ui/ui-deps';
import { useCreateTrafficLink, useRemoveTrafficLink } from './api';

const PLATFORM_ITEMS = TRAFFIC_LINK_PLATFORMS.map((p) => ({ value: p, label: p }));

type Removing = { link: TrafficLink; attempt: number; open: boolean };

export function LinksCard({ links, site, onMake, rangeWords }: { links: TrafficLink[]; site: TrafficSite; onMake: () => void; rangeWords: string }) {
  const [removing, setRemoving] = useState<Removing | null>(null);
  const [removed, setRemoved] = useState('');
  const startRemove = (link: TrafficLink) => setRemoving((r) => ({ link, attempt: (r?.attempt ?? 0) + 1, open: true }));
  const setOpen = (attempt: number, open: boolean) => setRemoving((r) => (r && r.attempt === attempt ? { ...r, open } : r));

  return (
    <Card>
      <CardHeader
        title="Tagged links"
        description={`A link for one post, so its visits count under where you posted it even when the app hides the referrer. Visits and sign-ups are for ${rangeWords}.`}
        action={
          <Button size="sm" onClick={onMake}>
            <Link2 aria-hidden />
            Make a link
          </Button>
        }
      />
      {links.length ? (
        <Table label="Tagged links">
          <THead>
            <Th>Link</Th>
            <Th>Posted on</Th>
            <Th align="right">Visitors</Th>
            <Th align="right">Sign-ups</Th>
            <Th>
              <span className="sr-only">Actions</span>
            </Th>
          </THead>
          <TBody>
            {links.map((link) => {
              const url = link.saved ? trafficLinkUrl(site.url, link.name, link.path) : null;
              return (
                <Tr key={link.name}>
                  <Td className="max-w-0 w-full">
                    <p className="truncate font-medium text-foreground">{link.name}</p>
                    <p className="truncate text-xs text-muted-foreground/80">
                      {url ?? 'Arrived as a tag nobody made here, such as a utm_campaign'}
                      {link.createdAt ? ` · made ${formatDate(link.createdAt)}` : ''}
                    </p>
                  </Td>
                  <Td className="whitespace-nowrap text-muted-foreground">{link.platform ?? 'Unknown'}</Td>
                  <Td align="right" className="tabular-nums">
                    {formatNumber(link.visitors)}
                  </Td>
                  <Td align="right" className="tabular-nums">
                    {formatNumber(link.signups)}
                  </Td>
                  <Td align="right">
                    <span className="inline-flex items-center gap-1">
                      {url ? <CopyButton value={url} label={`Copy ${link.name}`} size="sm" /> : null}
                      {link.saved ? (
                        <Button size="icon-sm" variant="ghost" aria-label={`Remove ${link.name}`} onClick={() => startRemove(link)}>
                          <Trash2 aria-hidden />
                        </Button>
                      ) : null}
                    </span>
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      ) : (
        <CardBody>
          <EmptyState
            compact
            icon={Link2}
            title="No tagged links yet"
            action={
              <Button size="sm" onClick={onMake}>
                Make a link
              </Button>
            }
          >
            Make one before you post in Telegram, Discord or WhatsApp. Those apps open links without saying where the click came from.
          </EmptyState>
        </CardBody>
      )}
      {removing ? (
        <RemoveLinkDialog
          key={removing.attempt}
          link={removing.link}
          open={removing.open}
          onOpenChange={(open) => setOpen(removing.attempt, open)}
          onRemoved={(name) => {
            setRemoved(`Removed ${name}`);
            setOpen(removing.attempt, false);
          }}
        />
      ) : null}
      <p role="status" className="sr-only">
        {removed}
      </p>
    </Card>
  );
}

/** "Remove {name}?". It owns its request, and each Remove opens a new one. */
function RemoveLinkDialog({
  link,
  open,
  onOpenChange,
  onRemoved,
}: {
  link: TrafficLink;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemoved: (name: string) => void;
}) {
  const remove = useRemoveTrafficLink({ onSuccess: onRemoved });
  // isPending flips a render late, so without this a fast second click sends a second request.
  const sending = useRef(false);
  const confirm = async () => {
    if (sending.current) return;
    sending.current = true;
    try {
      await remove.mutateAsync({ name: link.name });
    } catch {
      // remove.error holds it, and InlineError shows it here.
    } finally {
      sending.current = false;
    }
  };

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Remove ${link.name}?`}
      consequence="It leaves this list. The link keeps working, and the visits it already brought keep their tag."
      confirmLabel="Remove link"
      pending={remove.isPending}
      danger
      onConfirm={() => void confirm()}
    >
      <InlineError error={remove.error} />
    </ConfirmDialog>
  );
}

/** The page a new link opens first: the home page when the app offers it. */
function firstPage(site: TrafficSite): string {
  return site.linkPages.some((p) => p.value === '/') ? '/' : (site.linkPages[0]?.value ?? '/');
}

/** "Make a tagged link", then the link it made with a Copy link button. Mounted fresh for each Make. */
export function MakeLinkDialog({ open, onOpenChange, site }: { open: boolean; onOpenChange: (open: boolean) => void; site: TrafficSite }) {
  const formId = useId();
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState<TrafficLinkPlatform | null>(null);
  const [path, setPath] = useState(() => firstPage(site));
  const [touched, setTouched] = useState(false);
  const [made, setMade] = useState<TrafficLink | null>(null);
  const make = useCreateTrafficLink();
  const { copied, failed, copy } = useCopy();
  // isPending flips a render late, so without this a fast second click makes the request twice.
  const sending = useRef(false);
  const normalized = normalizeLinkName(name);
  const nameError = touched && !normalized ? 'Use letters, numbers and dashes, like launch-video.' : undefined;
  const platformError = touched && !platform ? 'Choose where you will post it.' : undefined;
  const madeUrl = made ? trafficLinkUrl(site.url, made.name, made.path) : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!normalized || !platform || sending.current) return;
    sending.current = true;
    try {
      setMade(await make.mutateAsync({ name: normalized, platform, path }));
    } catch {
      // make.error holds it, and InlineError shows it under the form.
    } finally {
      sending.current = false;
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {made && madeUrl ? (
        <DialogContent
          title={`Made ${made.name}`}
          description="Post this link instead of the plain address. Its visits count under where you posted it."
          footer={
            <>
              <Dialog.Close render={<Button variant="ghost" />}>Done</Dialog.Close>
              <Button key="copy" variant="primary" autoFocus onClick={(event) => void copy(madeUrl, event.currentTarget)}>
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                {copied ? 'Copied' : 'Copy link'}
              </Button>
            </>
          }
        >
          <p className="rounded-lg border border-input bg-background px-3 py-2 font-mono text-[13px] break-all text-foreground select-all">{madeUrl}</p>
          {failed ? (
            <p role="alert" className="mt-2 text-xs leading-relaxed text-danger-strong">
              {COPY_FAILED}
            </p>
          ) : null}
        </DialogContent>
      ) : (
        <DialogContent
          title="Make a tagged link"
          description="Post this link instead of the plain address. Its visits count under where you posted it."
          footer={
            <>
              <Dialog.Close render={<Button variant="ghost" />}>Cancel</Dialog.Close>
              <Button key="make" variant="primary" type="submit" form={formId} disabled={make.isPending}>
                {make.isPending ? <Spinner /> : null}
                Make link
              </Button>
            </>
          }
        >
          <form id={formId} onSubmit={(e) => void submit(e)} className="flex flex-col gap-5" noValidate>
            <Field
              label="Name"
              hint={normalized ? `The link: ${trafficLinkUrl(site.url, normalized, path)}` : 'A short name for the post, like launch-video.'}
              error={nameError}
            >
              <Input autoComplete="off" autoFocus value={name} placeholder="launch-video" maxLength={80} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Posted on" error={platformError}>
              <Select<TrafficLinkPlatform> value={platform} onValueChange={setPlatform} placeholder="Choose where" items={PLATFORM_ITEMS} />
            </Field>
            {/* With one page to offer, the link's address in the hint above already says where it opens. */}
            {site.linkPages.length > 1 ? (
              <Field label="Opens">
                <Select<string> value={path} onValueChange={setPath} items={site.linkPages.map((p) => ({ value: p.value, label: p.label }))} />
              </Field>
            ) : null}
            <InlineError error={make.error} />
          </form>
        </DialogContent>
      )}
    </Dialog.Root>
  );
}
