import { useState, useRef } from 'react';
import Link from 'next/link';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { GetServerSideProps } from 'next';
import { withUAL } from 'ual-reactjs-renderer';
import { CircleNotch, Info } from 'phosphor-react';
import { Disclosure, Popover } from '@headlessui/react';
import { useForm, Controller } from 'react-hook-form';

import {
  getCollectionService,
  CollectionProps,
} from '@services/collection/getCollectionService';
import { createTemplateService } from '@services/template/createTemplateService';
import {
  collectionSchemasService,
  SchemaProps,
} from '@services/collection/collectionSchemasService';
import { uploadImageToIpfsService } from '@services/collection/uploadImageToIpfsService';
import { collectionTemplatesService } from '@services/collection/collectionTemplatesService';

import { Select } from '@components/Select';
import { Switch } from '@components/Switch';
import { Input } from '@components/Input';
import { Modal } from '@components/Modal';
import { InputPreview } from '@components/InputPreview';
import { Header } from '@components/Header';

import { collectionTabs } from '@utils/collectionTabs';
import { usePermission } from '@hooks/usePermission';

import { appName } from '@configs/globalsConfig';
interface NewTemplateProps {
  ual: any;
  chainKey: string;
  collection: CollectionProps;
  schemas: SchemaProps[];
  schemasOptions: {
    label: string;
    value: string;
  }[];
}

interface ModalProps {
  title: string;
  message?: string;
  details?: string;
  isError?: boolean;
}

interface SchemaAttributesProps {
  isImmutable?: boolean;
  name: string;
  type: string;
}

interface FormDataProps {
  schemaName: string;
  transferable: boolean;
  burnable: boolean;
  maxSupply: number;
  attributes: SchemaAttributesProps[];
}

function NewTemplate({
  ual,
  collection,
  schemas,
  schemasOptions,
  chainKey,
}: NewTemplateProps) {
  const router = useRouter();
  const modalRef = useRef(null);

  const { PermissionDenied } = usePermission({
    loggedAccountName: ual?.activeUser?.accountName,
    collectionAuthor: collection.author,
    collectionAuthorizedAccounts: collection.authorized_accounts,
  });

  const [schemasAttributes, setSchemasAttributes] = useState<
    SchemaAttributesProps[]
  >(() => {
    const selectedSchema = schemas.find(
      (schema) => schema.schema_name === schemasOptions[0].value
    );
    const schemasAttributes = selectedSchema?.format ?? [];
    return schemasAttributes.map((schemaAttributes) => ({
      ...schemaAttributes,
      isImmutable: false,
    }));
  });

  const [isLoading, setIsLoading] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [modal, setModal] = useState<ModalProps>({
    title: '',
    message: '',
    details: '',
    isError: false,
  });

  const hasImmutableAttributes = schemasAttributes.some(
    (schemaAttribute) => schemaAttribute.isImmutable
  );

  const { register, handleSubmit, control, reset } = useForm<any>({
    defaultValues: {
      schemaName: schemasOptions[0]?.value,
      transferable: true,
      burnable: true,
      maxSupply: 100,
    },
  });

  function handleSetSchemasAttributes(schemaName: string) {
    reset();
    const selectedSchema = schemas.find(
      (schema) => schema.schema_name === schemaName
    );
    let schemasAttributes = selectedSchema?.format ?? [];
    schemasAttributes = schemasAttributes.map((schemaAttributes) => ({
      ...schemaAttributes,
      isImmutable: false,
    }));
    setSchemasAttributes(schemasAttributes);
  }

  function handleSetImmutableAttributes({ schemaAttributeIndex, isImmutable }) {
    setSchemasAttributes((state) => {
      state[schemaAttributeIndex].isImmutable = isImmutable;
      return [...state];
    });
  }

  async function onSubmit({
    schemaName,
    transferable,
    burnable,
    maxSupply,
    ...attributes
  }: FormDataProps) {
    setIsLoading(true);

    try {
      const filesAttributes = Object.keys(attributes).reduce(
        (accumulatorAttributes, keyAttribute) => {
          const attributeValue = attributes[`${keyAttribute}`];
          const shouldMakeUpload =
            typeof attributeValue === 'object' && attributeValue.length > 0;

          if (shouldMakeUpload) {
            return [
              ...accumulatorAttributes,
              {
                name: keyAttribute,
                value: attributeValue[0],
              },
            ];
          }
          return accumulatorAttributes;
        },
        []
      );

      const pinataFiles = await Promise.all(
        filesAttributes.map((fileAttribute) =>
          uploadImageToIpfsService(fileAttribute.value)
        )
      );

      filesAttributes.forEach((fileAttribute, fileAttributeIndex) => {
        attributes[fileAttribute.name] =
          pinataFiles[fileAttributeIndex]['IpfsHash'];
      });

      const immutableData = [];

      schemasAttributes.forEach(({ name, type, isImmutable }) => {
        if (!isImmutable) {
          return;
        }

        const attributeValue = attributes[`${name}`];

        if (type === 'image' || type === 'ipfs' || name === 'video') {
          immutableData.push({
            key: name,
            value: ['string', attributeValue],
          });
        } else if (type === 'bool') {
          immutableData.push({
            key: name,
            value: ['uint8', Number(attributeValue)],
          });
        } else if (type === 'double') {
          immutableData.push({
            key: name,
            value: ['float64', Number(attributeValue)],
          });
        } else if (type === 'uint64') {
          immutableData.push({
            key: name,
            value: ['uint64', Number(attributeValue)],
          });
        } else {
          immutableData.push({
            key: name,
            value: [type, attributeValue],
          });
        }
      });

      await createTemplateService({
        activeUser: ual.activeUser,
        authorized_creator: ual.activeUser.accountName,
        collectionName: collection.collection_name,
        schemaName,
        transferable,
        burnable,
        maxSupply: Number(maxSupply),
        immutableData,
      });

      setIsSaved(true);

      modalRef.current?.openModal();
      const title = 'Template was successfully created';
      const message = 'Please await while we redirect you.';

      setModal({
        title,
        message,
      });

      async function redirect() {
        const { data: templates } = await collectionTemplatesService(chainKey, {
          collectionName: collection.collection_name,
        });

        setIsSaved(false);

        router.push(
          `/${chainKey}/collection/${collection.collection_name}/template/${templates.data[0].template_id}`
        );
      }

      setTimeout(redirect, 3000);
    } catch (e) {
      modalRef.current?.openModal();
      const jsonError = JSON.parse(JSON.stringify(e));
      const details = JSON.stringify(e, undefined, 2);
      const message =
        jsonError?.cause?.json?.error?.details[0]?.message ??
        'Unable to create template';

      setModal({
        title: 'Error',
        message,
        details,
        isError: true,
      });
    }

    setIsLoading(false);
  }

  if (PermissionDenied) {
    return <PermissionDenied />;
  }

  if (schemas.length === 0) {
    return (
      <>
        <Head>
          <title>{`New Template - ${appName}`}</title>
        </Head>

        <Header.Root
          border
          breadcrumb={[
            ['My Collections', `/${chainKey}`],
            [
              collection.collection_name,
              `/${chainKey}/collection/${collection.collection_name}`,
            ],
            [
              collectionTabs[2].name,
              `/${chainKey}/collection/${collection.collection_name}?tab=${collectionTabs[2].key}`,
            ],
            ['New Template'],
          ]}
        >
          <Header.Content title="New Template" />
        </Header.Root>

        <div className="container py-8">
          <div className="flex flex-col gap-4 justify-center items-center bg-neutral-800 rounded-xl py-16">
            <span className="title-1">
              There is no schema, please create one to continue.
            </span>
            <Link
              href={`/${chainKey}/collection/${collection.collection_name}/schema/new`}
              className="btn"
            >
              Create schema
            </Link>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>{`New Template - ${appName}`}</title>
      </Head>

      <Header.Root
        border
        breadcrumb={[
          ['My Collections', `/${chainKey}`],
          [
            collection.collection_name,
            `/${chainKey}/collection/${collection.collection_name}`,
          ],
          [
            collectionTabs[2].name,
            `/${chainKey}/collection/${collection.collection_name}?tab=${collectionTabs[2].key}`,
          ],
          ['New Template'],
        ]}
      >
        <Header.Content title="New Template" />
      </Header.Root>

      <Modal ref={modalRef} title={modal.title}>
        <p className="body-2 mt-2">{modal.message}</p>
        {!modal.isError ? (
          <span className="flex gap-2 items-center py-4 body-2 font-bold text-white">
            <CircleNotch size={24} weight="bold" className="animate-spin" />
            Redirecting...
          </span>
        ) : (
          <Disclosure>
            <Disclosure.Button className="btn btn-small mt-4">
              Details
            </Disclosure.Button>
            <Disclosure.Panel>
              <pre className="overflow-auto p-4 rounded-lg bg-neutral-700 max-h-96 mt-4">
                {modal.details}
              </pre>
            </Disclosure.Panel>
          </Disclosure>
        )}
      </Modal>

      <div className="container py-8">
        <form onSubmit={handleSubmit(onSubmit)}>
          <div className="w-full flex flex-col gap-16">
            <div className="flex max-w-3xl flex-col gap-8">
              <Controller
                control={control}
                name="schemaName"
                render={({ field }) => (
                  <Select
                    label="Select schema"
                    hint={
                      hasImmutableAttributes
                        ? 'Changing the schema will clear the rest of the form'
                        : ''
                    }
                    onChange={(schemaName) => {
                      field.onChange(schemaName);
                      handleSetSchemasAttributes(schemaName);
                    }}
                    selectedValue={field.value}
                    options={schemasOptions}
                  />
                )}
              />
              <Controller
                control={control}
                name="transferable"
                render={({ field }) => (
                  <Switch
                    label="Assets can be transferred"
                    onChange={field.onChange}
                    checked={field.value}
                  />
                )}
              />
              <Controller
                control={control}
                name="burnable"
                render={({ field }) => (
                  <Switch
                    label="Assets can be burned"
                    onChange={field.onChange}
                    checked={field.value}
                  />
                )}
              />
              <Input
                {...register('maxSupply')}
                type="text"
                label="Max supply"
              />
            </div>

            <div>
              <h3 className="headline-2">Set Immutable Attributes</h3>
              <p className="body-1 text-neutral-400 max-w-3xl mb-8">
                Every attribute that is filled in here will be immutable. If you
                leave the attribute blank, you will be able to set that data
                during asset creation and it will be mutable.
              </p>

              {schemasAttributes.map(
                (schemaAttribute, schemaAttributeIndex) => (
                  <div
                    key={schemaAttribute.name}
                    className="grid grid-cols-12 gap-4 mt-8 pb-8 lg:pb-0 lg:mt-4 border-b border-neutral-700 lg:border-none"
                  >
                    <div
                      className={`col-span-12 sm:col-span-6 lg:col-span-3 xl:col-span-3 p-3 flex items-center justify-center border border-neutral-700 rounded ${
                        schemaAttribute.isImmutable ? '' : 'opacity-50'
                      }`}
                    >
                      <span className="body-2 font-bold text-white whitespace-nowrap">
                        {schemaAttribute.name}
                      </span>
                    </div>
                    <div className="col-span-12 sm:col-span-6 lg:col-span-6 xl:col-span-6">
                      {schemaAttribute.type === 'image' ? (
                        <InputPreview
                          {...register(schemaAttribute.name, {
                            onChange: () => {
                              handleSetImmutableAttributes({
                                schemaAttributeIndex,
                                isImmutable: true,
                              });
                            },
                          })}
                          title="Add Image"
                          accept="image/*"
                        />
                      ) : schemaAttribute.name === 'video' ? (
                        <InputPreview
                          {...register(schemaAttribute.name, {
                            onChange: () => {
                              handleSetImmutableAttributes({
                                schemaAttributeIndex,
                                isImmutable: true,
                              });
                            },
                          })}
                          title="Add Video"
                          accept="video/*"
                        />
                      ) : schemaAttribute.type === 'bool' ? (
                        <div className="p-3 bg-neutral-800 border border-neutral-700 rounded">
                          <Controller
                            control={control}
                            name={schemaAttribute.name}
                            defaultValue={false}
                            render={({ field }) => (
                              <Switch
                                onChange={(value) => {
                                  handleSetImmutableAttributes({
                                    schemaAttributeIndex,
                                    isImmutable: true,
                                  });
                                  field.onChange(value);
                                }}
                                checked={Boolean(field.value)}
                                label={field.value ? 'Enabled' : 'Disabled'}
                              />
                            )}
                          />
                        </div>
                      ) : schemaAttribute.type === 'uint64' ? (
                        <Input
                          {...register(schemaAttribute.name, {
                            onChange: () => {
                              handleSetImmutableAttributes({
                                schemaAttributeIndex,
                                isImmutable: true,
                              });
                            },
                          })}
                          type="number"
                          name={schemaAttribute.name}
                          placeholder="whole number"
                        />
                      ) : schemaAttribute.type === 'double' ? (
                        <Input
                          {...register(schemaAttribute.name, {
                            onChange: () => {
                              handleSetImmutableAttributes({
                                schemaAttributeIndex,
                                isImmutable: true,
                              });
                            },
                          })}
                          type="number"
                          name={schemaAttribute.name}
                          placeholder="number"
                          step="0.01"
                        />
                      ) : schemaAttribute.type === 'ipfs' ? (
                        <InputPreview
                          {...register(schemaAttribute.name, {
                            onChange: () => {
                              handleSetImmutableAttributes({
                                schemaAttributeIndex,
                                isImmutable: true,
                              });
                            },
                          })}
                          title="Add Image"
                        />
                      ) : schemaAttribute.type === 'string' ? (
                        <Input
                          {...register(schemaAttribute.name, {
                            onChange: () => {
                              handleSetImmutableAttributes({
                                schemaAttributeIndex,
                                isImmutable: true,
                              });
                            },
                          })}
                          type="text"
                          name={schemaAttribute.name}
                          placeholder="text"
                        />
                      ) : (
                        <Input
                          {...register(schemaAttribute.name, {
                            onChange: () => {
                              handleSetImmutableAttributes({
                                schemaAttributeIndex,
                                isImmutable: true,
                              });
                            },
                          })}
                          type="text"
                          name={schemaAttribute.name}
                          placeholder={schemaAttribute.type}
                        />
                      )}
                    </div>
                    <div className="col-span-12 lg:col-span-3 xl:col-span-3 py-[calc(0.5rem-1px)] pr-[calc(0.5rem-1px)] pl-4 border border-neutral-700 rounded">
                      <div className="flex items-center justify-between">
                        <div
                          className={`flex-1 ${
                            schemaAttribute.isImmutable ? '' : 'opacity-50'
                          }`}
                        >
                          <Switch
                            label={
                              schemaAttribute.isImmutable
                                ? 'Immutable'
                                : 'Mutable'
                            }
                            onChange={() =>
                              handleSetImmutableAttributes({
                                schemaAttributeIndex,
                                isImmutable: !schemaAttribute.isImmutable,
                              })
                            }
                            checked={schemaAttribute.isImmutable}
                          />
                        </div>
                        <div className="flex-none">
                          <Popover className="relative">
                            <Popover.Button
                              className={`btn btn-square btn-small btn-ghost ${
                                schemaAttribute.isImmutable ? '' : 'opacity-50'
                              }`}
                            >
                              <Info size={24} />
                            </Popover.Button>
                            <Popover.Panel className="w-64 p-4 absolute z-10 bg-neutral-700 top-12 right-0 rounded">
                              {schemaAttribute.isImmutable ? (
                                <p className="body-3">
                                  <strong className="text-white">
                                    Immutable:
                                  </strong>{' '}
                                  This field will be set on the template. This
                                  field (even if left blank) will not be
                                  editable later.
                                </p>
                              ) : (
                                <p className="body-3">
                                  <strong className="text-white">
                                    Mutable:
                                  </strong>{' '}
                                  This field will not be set on the template.
                                  You will have the option to set a custom value
                                  on each NFT you mint.
                                </p>
                              )}
                            </Popover.Panel>
                          </Popover>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              )}
            </div>

            <div>
              {isLoading ? (
                <span className="flex gap-2 items-center p-4 body-2 font-bold text-white">
                  <CircleNotch
                    size={24}
                    weight="bold"
                    className="animate-spin"
                  />
                  Loading...
                </span>
              ) : (
                <button
                  type="submit"
                  className={`btn ${
                    isSaved ? 'animate-pulse bg-emerald-600' : ''
                  }`}
                >
                  {isSaved ? 'Saved' : 'Create template'}
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </>
  );
}

export const getServerSideProps: GetServerSideProps = async ({ params }) => {
  const chainKey = params.chainKey as string;
  const collectionName = params.collectionName as string;

  const [{ data: collection }, { data: schemas }] = await Promise.all([
    getCollectionService(chainKey, { collectionName }),
    collectionSchemasService(chainKey, { collectionName }),
  ]);

  const schemasOptions = schemas.data.map((schema) => ({
    label: schema.schema_name,
    value: schema.schema_name,
  }));

  return {
    props: {
      chainKey,
      collection: collection.data,
      schemas: schemas.data,
      schemasOptions,
    },
  };
};

export default withUAL(NewTemplate);
