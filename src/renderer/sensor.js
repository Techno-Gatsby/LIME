let armed = true;
const isFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', (e) => {
  if (!isFiles(e)) return;
  e.preventDefault();
  if (!armed) return;
  armed = false;
  window.lime.invoke('sensor:enter');
  setTimeout(() => { armed = true; }, 1500);
});
window.addEventListener('dragover', (e) => { if (isFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const files = [...(e.dataTransfer?.files || [])].map((f) => window.lime.pathFor(f)).filter(Boolean);
  if (files.length) window.lime.invoke('sensor:drop', files);
});
