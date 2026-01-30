// Social Sharing Functions
function shareOnTwitter() {
  const text = `J'ai contribué à FRESQ V2, une fresque collaborative de 200x200 pixels! 🎨`;
  const url = window.location.origin;
  window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, '_blank');
}

function shareOnFacebook() {
  const url = window.location.origin;
  window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, '_blank');
}

function shareOnLinkedIn() {
  const url = window.location.origin;
  const title = 'FRESQ V2 - Fresque Collaborative';
  const summary = 'Participe à cette fresque collaborative géante de 200x200 pixels!';
  window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`, '_blank');
}

function copyShareLink() {
  const url = window.location.origin;
  navigator.clipboard.writeText(url).then(() => {
    alert('✅ Lien copié dans le presse-papier!');
  }).catch(() => {
    prompt('Copie ce lien:', url);
  });
}

function shareMyCell(x, y, color) {
  const text = `J'ai peint la case (${x}, ${y}) sur FRESQ V2! 🎨`;
  const url = `${window.location.origin}?cell=${x},${y}`;
  
  if (navigator.share) {
    navigator.share({
      title: 'FRESQ V2',
      text: text,
      url: url
    }).catch(() => {});
  } else {
    shareOnTwitter();
  }
}

// Export for use in main app
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { shareOnTwitter, shareOnFacebook, shareOnLinkedIn, copyShareLink, shareMyCell };
}
