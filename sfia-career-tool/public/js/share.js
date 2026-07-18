// Reusable read-only share-link control (FRD Phase-2 sharing).
// Mounts into a container element and manages create / copy / revoke.
// opts: { mount: HTMLElement, shareType: 'assessment'|'plan', resourceId: number|null, label?: string }
async function initShareControl(opts) {
  const { mount, shareType, resourceId = null } = opts;
  const noun = opts.label || (shareType === 'plan' ? 'your development plan' : 'this result');

  const render = async () => {
    let links = [];
    try { links = await Api.get('/api/user/share'); } catch (e) { /* ignore */ }
    const existing = links.find(l => l.share_type === shareType &&
      (shareType === 'plan' ? true : String(l.resource_id) === String(resourceId)));

    if (existing) {
      const url = `${location.origin}/shared.html?token=${existing.token}`;
      mount.innerHTML = `
        <h2>Share (read-only)</h2>
        <p class="muted" style="margin-top:0;">Anyone with this link can view a read-only copy of ${escapeHtml(noun)}. No sign-in required.</p>
        <div class="share-url-row">
          <input type="text" readonly id="share-url" value="${escapeHtml(url)}">
          <button class="btn btn-secondary btn-sm" id="share-copy" type="button">Copy link</button>
          <button class="btn btn-secondary btn-sm" id="share-revoke" type="button">Revoke</button>
        </div>
        <div id="share-msg" class="muted" style="font-size:0.8rem; min-height:1.1em; margin-top:0.4rem;"></div>`;
      mount.querySelector('#share-copy').addEventListener('click', async () => {
        const inp = mount.querySelector('#share-url');
        inp.focus(); inp.select();
        try { await navigator.clipboard.writeText(inp.value); }
        catch (e) { try { document.execCommand('copy'); } catch (e2) { /* ignore */ } }
        mount.querySelector('#share-msg').textContent = 'Link copied to clipboard.';
      });
      mount.querySelector('#share-revoke').addEventListener('click', async () => {
        await Api.delete(`/api/user/share/${existing.id}`);
        render();
      });
    } else {
      mount.innerHTML = `
        <h2>Share (read-only)</h2>
        <p class="muted" style="margin-top:0;">Create a link to share a read-only copy of ${escapeHtml(noun)}. No sign-in is required to view it, and you can revoke the link at any time.</p>
        <button class="btn btn-secondary" id="share-create" type="button">Create share link</button>`;
      mount.querySelector('#share-create').addEventListener('click', async (e) => {
        e.target.disabled = true;
        try { await Api.post('/api/user/share', { shareType, resourceId }); render(); }
        catch (err) { e.target.disabled = false; alert(err.message); }
      });
    }
  };

  await render();
}
