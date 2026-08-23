module.exports = ({ config }) => {
  const projectId = process.env.EAS_PROJECT_ID ?? config.extra?.eas?.projectId;
  if (!projectId) return config;

  return {
    ...config,
    extra: {
      ...config.extra,
      eas: {
        ...config.extra?.eas,
        projectId,
      },
    },
  };
};
