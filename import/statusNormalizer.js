// Converts messy free-text legacy status (e.g. "Alhamthulillah... Handed Over on 22-Oct-25")
// into the canonical structured fields the system tracks.
// Original text is always preserved in legacy_status_text / legacy_remarks - nothing is lost.

function normalizeStatus(rawText, { hasContractDate = false, sheetImpliesConfirmed = false } = {}) {
  const text = (rawText || '').toLowerCase();

  const result = {
    status: sheetImpliesConfirmed || hasContractDate ? 'Confirmed' : 'Quoted',
    delivery_status: 'Pending',
    installation_status: 'Not Started',
    handover_status: 'Pending',
  };

  if (!text) return result;

  if (text.includes('cancel')) {
    result.status = 'Lost';
    return result;
  }
  if (text.includes('on hold') || text.includes(' hold')) {
    result.status = 'On Hold';
    return result;
  }
  if (text.includes('contract finalized') || text.includes('contract finalised') || text.includes('contract is finalized')) {
    result.status = 'Confirmed';
    return result;
  }

  // Once we're past "confirmed", track delivery / installation / handover progress
  result.status = 'Confirmed';

  if (text.includes('handed over') || text.includes('handover on') || text.includes('handedover')) {
    result.delivery_status = 'Delivered';
    result.installation_status = 'Completed';
    result.handover_status = 'Handed Over';
    return result;
  }
  if (text.includes('yet to handover') || text.includes('ready for handover')) {
    result.delivery_status = 'Delivered';
    result.installation_status = 'Completed';
    result.handover_status = 'Pending';
    return result;
  }
  if (text.includes('completed') && !text.includes('partially')) {
    result.delivery_status = 'Delivered';
    result.installation_status = 'Completed';
    return result;
  }
  if (text.includes('partially completed')) {
    result.delivery_status = 'Delivered';
    result.installation_status = 'In Progress';
    return result;
  }
  if (text.includes('material ready at factory') || text.includes('material delivered') || text.includes('site not ready')) {
    result.delivery_status = 'Delivered';
    result.installation_status = 'Not Started';
    return result;
  }
  if (text.includes('mechanical work') || text.includes('electrical work') || text.includes('going on') || text.includes('installation')) {
    result.installation_status = 'In Progress';
    return result;
  }
  if (text.includes('advance') || text.includes('token')) {
    // contract confirmed, payment-stage remarks - leave delivery/installation as not started
    return result;
  }

  return result;
}

module.exports = { normalizeStatus };
