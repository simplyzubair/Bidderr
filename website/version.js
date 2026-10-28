// Shows the newest version number from GitHub. The download links work without this.
fetch('https://api.github.com/repos/simplyzubair/Bidderr/releases/latest')
  .then((r) => (r.ok ? r.json() : null))
  .then((data) => {
    if (data?.tag_name) {
      document.getElementById('version').textContent = `Latest version ${data.tag_name.replace(/^v/, '')}. Select a job post, get a proposal in seconds.`;
    }
  })
  .catch(() => {});
