const pngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAwAAAAICAYAAADN5B7xAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAFklEQVQYlWOQc+v5TwpmGNXgRoNQAgCcm7mh+9cD/gAAAABJRU5ErkJggg==';

const jpegBase64 =
  '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAIAAwDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABv/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AIcAaK3/2Q==';

export const createRasterFile = (kind: 'jpeg' | 'png'): File =>
  new File([Buffer.from(kind === 'png' ? pngBase64 : jpegBase64, 'base64')], `angel.${kind}`, {
    type: kind === 'png' ? 'image/png' : 'image/jpeg',
  });
