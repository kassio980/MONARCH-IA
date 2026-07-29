function isOwner(userId, ownerId) {
  return String(userId) === String(ownerId);
}

module.exports = {
  isOwner,
};
