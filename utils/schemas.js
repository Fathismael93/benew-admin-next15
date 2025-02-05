import * as yup from 'yup';

export const presentationSchema = yup.object().shape({
  name: yup
    .string()
    .required('Name is required')
    .min(3, 'Name must be longer than 3 characters'),
  title: yup
    .string()
    .required('Title is required')
    .min(7, 'Title must be longer than 7 characters'),
  text: yup
    .string()
    .required('Text is required')
    .min(10, 'Text must be longer than 3 characters'),
});

export const deletePresentationSchema = yup.object().shape({
  id: yup.number().positive("This presentation id doesn't exist"),
});

export const addArticleSchema = yup.object().shape({
  title: yup
    .string()
    .required('Title is required')
    .min(10, 'Title must be longer than 10 characters'),
  text: yup
    .string()
    .required('Text is required')
    .min(500, 'Text must be longer than 500 characters'),
  imageUrl: yup.string().required('Image is missing for this article'),
});

export const articleIDSchema = yup.object().shape({
  id: yup.number().positive("This article id doesn't exist"),
});
